import { logger } from "@main/services/logger";

import type { Game, RestoreManifestFile } from "@types";

import { getEmulatorConfig } from "../emulators/emulators-repository";
import { rpcs3ConfigRoots } from "../emulators/emulator-config";
import {
  emulatorSaveFileKey,
  emulatorRestoreRule,
} from "./emulator-provider-identity";
import type {
  EmulatorProvider,
  EmulatorProviderContext,
} from "./emulator-provider-types";
import { getRpcs3SavedataTitleIds } from "./rpcs3-savedata-title-ids.js";
import { rpcs3TitleIdsForGame } from "./rpcs3-title-ids.js";
import { resolveRpcs3ConfigRootStatus } from "./rpcs3-config-root";
import {
  scanRpcs3SaveRoot,
  scanRpcs3Savestates,
  unresolvedCoverage,
} from "./rpcs3-save-scanner";
import { resolveRpcs3SavestateRestoreRule } from "./rpcs3-savestate-restore";
import { resolveRpcs3SavedataRestoreRule } from "./rpcs3-savedata-restore.js";
import {
  getRpcs3ProfileBinding,
  setRpcs3ProfileBinding,
} from "./rpcs3-profile-binding-store";
import {
  chooseRpcs3CloudProfileId,
  listRpcs3CloudProfileIds,
} from "./rpcs3-profile-binding-policy";

export const resolveRpcs3ActiveSaveLocation = async () => {
  const emulator = await getEmulatorConfig("ps3");
  const { status, location } = await resolveRpcs3ConfigRootStatus(
    emulator.executablePath,
    emulator.rpcs3ConfigRoot
  );
  if (location) return location;
  logger.warn("[Cloud Save] RPCS3 config root unavailable", {
    status: status.status,
    selectedRoot: status.selectedRoot,
    checkedPaths: rpcs3ConfigRoots(emulator.executablePath),
  });
  const code = {
    "not-configured": "cloud_save_rpcs3_not_configured",
    missing: "cloud_save_rpcs3_config_missing",
    ambiguous: "cloud_save_rpcs3_config_ambiguous",
    "invalid-selection": "cloud_save_rpcs3_config_invalid_selection",
    ready: "cloud_save_rpcs3_config_missing",
  }[status.status];
  throw new Error(code);
};

export const getRpcs3SaveEnvironmentKey = async (game: Game) => {
  const resolved = await resolveRpcs3ActiveSaveLocation().catch(() => null);
  const binding = resolved
    ? await getRpcs3ProfileBinding(
        game.shop,
        game.objectId,
        resolved.configRoot,
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
    location.configRoot,
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
  const { configRoot, homeRoot, activeProfileId } = location;
  const binding = await getRpcs3ProfileBinding(
    game.shop,
    game.objectId,
    configRoot,
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
    configRoot,
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

export const rpcs3SaveProvider: EmulatorProvider = {
  async discover(context: EmulatorProviderContext) {
    try {
      const { configRoot, homeRoot, activeProfileId } =
        await resolveRpcs3ActiveSaveLocation();
      const binding = await getRpcs3ProfileBinding(
        context.game.shop,
        context.game.objectId,
        configRoot,
        homeRoot,
        activeProfileId
      );
      const rpcs3SavedataTitleIds =
        context.rpcs3SavedataTitleIds ??
        (await getRpcs3SavedataTitleIds(context.game));
      const [savedata, savestates] = await Promise.all([
        scanRpcs3SaveRoot(
          { ...context, rpcs3SavedataTitleIds },
          homeRoot,
          activeProfileId,
          binding?.cloudProfileId ?? activeProfileId
        ),
        scanRpcs3Savestates(context, configRoot),
      ]);
      return {
        files: [...savedata.files, ...savestates.files],
        coverage: [...savedata.coverage, ...savestates.coverage],
        revision: "rpcs3-v3",
      };
    } catch {
      return {
        files: [],
        coverage: [unresolvedCoverage("rpcs3-vfs-unresolved")],
        revision: "rpcs3-v3",
      };
    }
  },
  async restoreRules(game: Game, files, rpcs3SavedataTitleIds) {
    if (!rpcs3TitleIdsForGame(game).length) return new Map();
    const allowedTitleIds = new Set(
      rpcs3SavedataTitleIds ?? (await getRpcs3SavedataTitleIds(game))
    );
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
      configRoot,
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
      const rule = await resolveRpcs3SavedataRestoreRule(
        file,
        allowedTitleIds,
        homeRoot,
        activeProfileId,
        binding?.cloudProfileId
      );
      if (rule) rules.set(emulatorSaveFileKey(file), rule);
    }
    return rules;
  },
};
