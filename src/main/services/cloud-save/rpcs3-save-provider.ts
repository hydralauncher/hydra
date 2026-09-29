import { promises as fs } from "node:fs";
import path from "node:path";

import type { Game, RestoreManifestFile } from "@types";

import { getEmulatorConfig } from "../emulators/emulators-repository";
import { rpcs3ConfigRoots } from "../emulators/emulator-config";
import {
  emulatorSaveFileKey,
  emulatorRestoreRule,
  parseRpcs3SaveRawPath,
  safeRelativeSegments,
} from "./emulator-provider-identity";
import type {
  EmulatorProvider,
  EmulatorProviderContext,
} from "./emulator-provider-types";
import {
  parseRpcs3ActiveProfileId,
  resolveRpcs3VfsHdd0,
  rpcs3SlotBelongsToTitle,
  rpcs3TitleIdsForGame,
} from "./rpcs3-save-layout";
import {
  scanRpcs3SaveRoot,
  scanRpcs3Savestates,
  unresolvedCoverage,
} from "./rpcs3-save-scanner";
import { resolveRpcs3SavestateRestoreRule } from "./rpcs3-savestate-restore";
import {
  getRpcs3ProfileBinding,
  setRpcs3ProfileBinding,
} from "./rpcs3-profile-binding-store";
import {
  chooseRpcs3CloudProfileId,
  listRpcs3CloudProfileIds,
} from "./rpcs3-profile-binding-policy";

const exists = async (target: string) =>
  fs.stat(target).then(
    () => true,
    () => false
  );

export const resolveRpcs3ActiveSaveLocation = async () => {
  const emulator = await getEmulatorConfig("ps3");
  if (!emulator.executablePath || !(await exists(emulator.executablePath))) {
    throw new Error("cloud_save_rpcs3_not_configured");
  }
  const candidates = await Promise.all(
    [...new Set(rpcs3ConfigRoots(emulator.executablePath))].map(
      async (root) => ({
        root,
        active:
          (await exists(path.join(root, "vfs.yml"))) ||
          (await exists(
            path.join(root, "GuiConfigs", "persistent_settings.dat")
          )) ||
          (await exists(path.join(root, "config.yml"))),
      })
    )
  );
  const active = candidates.filter((candidate) => candidate.active);
  if (active.length !== 1) {
    throw new Error("cloud_save_rpcs3_config_ambiguous");
  }
  const configRoot = await fs.realpath(active[0].root);
  const vfsContent = await fs
    .readFile(path.join(configRoot, "vfs.yml"), "utf8")
    .catch((error: NodeJS.ErrnoException) => {
      if (error.code === "ENOENT") return null;
      throw error;
    });
  const hdd0 = resolveRpcs3VfsHdd0(configRoot, vfsContent);
  const realHdd0 = await fs.realpath(hdd0);
  const settingsContent = await fs
    .readFile(
      path.join(configRoot, "GuiConfigs", "persistent_settings.dat"),
      "utf8"
    )
    .catch((error: NodeJS.ErrnoException) => {
      if (error.code === "ENOENT") return null;
      throw error;
    });
  const activeProfileId = parseRpcs3ActiveProfileId(settingsContent);
  if (!activeProfileId) {
    throw new Error("cloud_save_rpcs3_active_profile_unresolved");
  }
  return { configRoot, homeRoot: path.join(realHdd0, "home"), activeProfileId };
};

export const getRpcs3SaveEnvironmentKey = async (game: Game) => {
  const resolved = await resolveRpcs3ActiveSaveLocation().catch(() => null);
  const binding = resolved
    ? await getRpcs3ProfileBinding(
        game.shop,
        game.objectId,
        resolved.homeRoot,
        resolved.activeProfileId
      ).catch(() => null)
    : null;
  return resolved
    ? JSON.stringify([
        "rpcs3-active-profile-v2",
        resolved,
        binding?.cloudProfileId ?? resolved.activeProfileId,
      ])
    : "rpcs3-save-root-unresolved";
};

export const getRpcs3ProfilePairing = async (game: Game) => {
  const location = await resolveRpcs3ActiveSaveLocation();
  const binding = await getRpcs3ProfileBinding(
    game.shop,
    game.objectId,
    location.homeRoot,
    location.activeProfileId
  );
  return { ...location, binding };
};

export const ensureRpcs3ProfileBindingForAnalysis = async (
  game: Game,
  remoteFiles: Pick<RestoreManifestFile, "rawPath">[]
): Promise<boolean> => {
  const location = await resolveRpcs3ActiveSaveLocation().catch(() => null);
  if (!location) return false;
  const { homeRoot, activeProfileId } = location;
  const binding = await getRpcs3ProfileBinding(
    game.shop,
    game.objectId,
    homeRoot,
    activeProfileId
  );
  const remoteProfiles = listRpcs3CloudProfileIds(remoteFiles);
  const cloudProfileId = chooseRpcs3CloudProfileId(
    remoteProfiles,
    binding,
    activeProfileId
  );
  if (!cloudProfileId) return false;
  if (binding?.cloudProfileId === cloudProfileId) return false;
  await setRpcs3ProfileBinding(game.shop, game.objectId, {
    homeRoot,
    localProfileId: activeProfileId,
    cloudProfileId,
  });
  return true;
};

export const ensureRpcs3ProfileBindingForSync = async (
  game: Game,
  remoteFiles: Pick<RestoreManifestFile, "rawPath">[],
  _localFiles: Pick<RestoreManifestFile, "rawPath">[]
) => {
  const { activeProfileId, binding } = await getRpcs3ProfilePairing(game);
  const remoteProfiles = listRpcs3CloudProfileIds(remoteFiles);
  const chosenProfileId = chooseRpcs3CloudProfileId(
    remoteProfiles,
    binding,
    activeProfileId
  );
  if (
    !chosenProfileId ||
    (remoteProfiles.length > 0 && binding?.cloudProfileId !== chosenProfileId)
  ) {
    throw new Error("cloud_save_rpcs3_profile_binding_required");
  }
};

const isSafeTarget = async (root: string, segments: string[]) => {
  const target = path.resolve(root, ...segments);
  if (!target.startsWith(`${path.resolve(root)}${path.sep}`)) return false;
  let current = root;
  for (const segment of segments) {
    current = path.join(current, segment);
    const stat = await fs
      .lstat(current)
      .catch((error: NodeJS.ErrnoException) =>
        error.code === "ENOENT" ? null : undefined
      );
    if (stat === undefined || stat?.isSymbolicLink()) return false;
  }
  return true;
};

export const rpcs3SaveProvider: EmulatorProvider = {
  async discover(context: EmulatorProviderContext) {
    try {
      const { configRoot, homeRoot, activeProfileId } =
        await resolveRpcs3ActiveSaveLocation();
      const binding = await getRpcs3ProfileBinding(
        context.game.shop,
        context.game.objectId,
        homeRoot,
        activeProfileId
      );
      const [savedata, savestates] = await Promise.all([
        scanRpcs3SaveRoot(
          context,
          homeRoot,
          activeProfileId,
          binding?.cloudProfileId ?? activeProfileId
        ),
        scanRpcs3Savestates(context, configRoot),
      ]);
      return {
        files: [...savedata.files, ...savestates.files],
        coverage: [...savedata.coverage, ...savestates.coverage],
        revision: "rpcs3-v2",
      };
    } catch {
      return {
        files: [],
        coverage: [unresolvedCoverage("rpcs3-vfs-unresolved")],
        revision: "rpcs3-v2",
      };
    }
  },
  async restoreRules(game: Game, files) {
    const allowedTitleIds = new Set(rpcs3TitleIdsForGame(game));
    let homeRoot: string;
    let activeProfileId: string;
    let configRoot: string;
    try {
      ({ configRoot, homeRoot, activeProfileId } =
        await resolveRpcs3ActiveSaveLocation());
    } catch {
      return new Map();
    }
    const binding = await getRpcs3ProfileBinding(
      game.shop,
      game.objectId,
      homeRoot,
      activeProfileId
    );
    const rules = new Map<string, ReturnType<typeof emulatorRestoreRule>>();
    for (const file of files) {
      const stateRule = await resolveRpcs3SavestateRestoreRule(
        game,
        file,
        configRoot
      );
      if (stateRule) {
        rules.set(emulatorSaveFileKey(file), stateRule);
        continue;
      }
      const parsed = parseRpcs3SaveRawPath(file.rawPath);
      const segments = safeRelativeSegments(file.relativePath);
      if (
        !parsed ||
        parsed.profileId !== binding?.cloudProfileId ||
        !allowedTitleIds.has(parsed.titleId) ||
        !segments ||
        segments.length < 2 ||
        !rpcs3SlotBelongsToTitle(segments[0], parsed.titleId)
      ) {
        continue;
      }
      const profileRoot = path.join(homeRoot, activeProfileId);
      const profile = await fs.lstat(profileRoot).catch(() => null);
      if (!profile?.isDirectory() || profile.isSymbolicLink()) continue;
      const saveRoot = path.join(profileRoot, "savedata");
      const saveRootStat = await fs.lstat(saveRoot).catch(() => null);
      if (saveRootStat?.isSymbolicLink()) continue;
      if (!(await isSafeTarget(saveRoot, segments))) continue;
      rules.set(
        emulatorSaveFileKey(file),
        emulatorRestoreRule(file.rawPath, saveRoot, "dir")
      );
    }
    return rules;
  },
};
