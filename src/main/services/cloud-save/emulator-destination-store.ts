import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";

import {
  cloudSaveEmulatorDestinationsSublevel,
  db,
  levelKeys,
} from "@main/level";
import type {
  Game,
  ResolvedRestoreTarget,
  RestoreManifestFile,
  User,
} from "@types";

import { cloudSaveFileKey } from "./cloud-save-contract.js";
import {
  getEmulatorRestoreRules,
  getEmulatorSaveProvider,
} from "./emulator-save-provider.js";
import {
  emulatorSaveFileKey,
  parseRetroArchSaveRawPath,
  parseRpcs3SavestateRawPath,
} from "./emulator-provider-identity.js";
import { serialsForGame } from "./playstation-save-common.js";
import {
  emulatorDestinationKindForFile,
  isCurrentEmulatorDestinationBinding,
  isSameExistingEmulatorDestination,
  type EmulatorDestinationKind,
} from "./emulator-destination-policy.js";

export {
  emulatorDestinationKindForFile,
  isCurrentEmulatorDestinationBinding,
  isSafeExistingEmulatorDestination,
  isSameExistingEmulatorDestination,
  type EmulatorDestinationKind,
} from "./emulator-destination-policy.js";

export const getExpectedEmulatorDestination = async (
  game: Game,
  rawPath: string,
  kind: EmulatorDestinationKind,
  relativePath?: string
): Promise<string | null> => {
  const provider = getEmulatorSaveProvider(game);
  if (provider === "retroarch" && parseRetroArchSaveRawPath(rawPath)) {
    const { locationsForGame } = await import("./retroarch-save-provider.js");
    const locations = (await locationsForGame(game).catch(() => null))
      ?.locations;
    const matching =
      locations?.filter((item) => item.rawPath === rawPath) ?? [];
    if (matching.length !== 1) return null;
    const root =
      kind === "save" ? matching[0].saveDirectory : matching[0].stateDirectory;
    return root ? path.resolve(root) : null;
  }
  if (provider === "ppsspp") {
    const match =
      /^<emulator>\/ppsspp\/(savedata|state)\/([A-Z]{4}\d{5})$/.exec(rawPath);
    if (!match || (kind === "save") !== (match[1] === "savedata")) {
      return null;
    }
    const { resolvePpssppSaveLocation, titleIdsForGame } = await import(
      "./ppsspp-save-provider.js"
    );
    if (!titleIdsForGame(game).includes(match[2])) return null;
    const location = await resolvePpssppSaveLocation().catch(() => null);
    if (!location) return null;
    return path.resolve(
      location.pspRoot,
      kind === "save" ? "SAVEDATA" : "PPSSPP_STATE"
    );
  }
  if (kind === "state" && provider === "duckstation") {
    const match = /^<emulator>\/duckstation-state\/([A-Z]{4}-\d{5})$/.exec(
      rawPath
    );
    if (!match || !serialsForGame(game).has(match[1])) return null;
    const { loadDuckstationSaveConfig } = await import(
      "./duckstation-save-provider.js"
    );
    const config = await loadDuckstationSaveConfig().catch(() => null);
    return config ? path.resolve(config.statesDir) : null;
  }
  if (kind === "state" && provider === "pcsx2") {
    const match = /^<emulator>\/pcsx2-state\/([A-Z]{4}-\d{5})$/.exec(rawPath);
    if (!match || !serialsForGame(game).has(match[1])) return null;
    const { loadPcsx2SaveConfig } = await import("./pcsx2-save-provider.js");
    const config = await loadPcsx2SaveConfig().catch(() => null);
    return config ? path.resolve(config.statesDir) : null;
  }
  if (kind === "state" && provider === "dolphin") {
    const match = /^<emulator>\/dolphin-state\/([A-Z0-9]{6})$/.exec(rawPath);
    if (!match) return null;
    const { gameIds, resolveDolphinSaveLocation } = await import(
      "./dolphin-save-provider.js"
    );
    if (!gameIds(game).includes(match[1])) return null;
    const location = await resolveDolphinSaveLocation().catch(() => null);
    return location ? path.resolve(location.userDir, "StateSaves") : null;
  }
  if (kind === "state" && provider === "rpcs3") {
    const state = parseRpcs3SavestateRawPath(rawPath);
    if (!state) return null;
    const { rpcs3TitleIdsForGame } = await import("./rpcs3-save-layout.js");
    if (!rpcs3TitleIdsForGame(game).includes(state.titleId)) return null;
    const { resolveRpcs3ActiveSaveLocation } = await import(
      "./rpcs3-save-provider.js"
    );
    const location = await resolveRpcs3ActiveSaveLocation().catch(() => null);
    return location
      ? path.resolve(location.configRoot, "savestates", state.titleId)
      : null;
  }
  if (
    kind === "save" &&
    relativePath &&
    ((provider === "dolphin" &&
      /^<emulator>\/dolphin-(?:gci|wii)\//.test(rawPath)) ||
      (provider === "pcsx2" && /^<emulator>\/pcsx2-folder\//.test(rawPath)) ||
      (provider === "rpcs3" && /^<emulator>\/rpcs3\//.test(rawPath)))
  ) {
    const file = {
      variantId: "emulator-destination",
      rawPath,
      relativePath,
    } as RestoreManifestFile;
    const rule = (await getEmulatorRestoreRules(game, [file])).get(
      emulatorSaveFileKey(file)
    );
    if (!rule?.preferredPath) return null;
    return path.resolve(
      rule.kind === "dir"
        ? rule.preferredPath
        : path.dirname(rule.preferredPath)
    );
  }
  return null;
};

const bindingKey = async (
  game: Game,
  rawPath: string,
  kind: EmulatorDestinationKind
) => {
  const user = await db.get<string, User>(levelKeys.user, {
    valueEncoding: "json",
  });
  if (!user?.id) throw new Error("cloud_save_user_required");
  return JSON.stringify([
    user.id,
    game.shop,
    game.objectId,
    os.hostname(),
    rawPath,
    kind,
  ]);
};

const bindingRecord = async (
  game: Game,
  rawPath: string,
  kind: EmulatorDestinationKind
): Promise<{
  path: string;
  canonicalPath: string;
  device: number;
  inode: number;
  sampleRelativePath: string;
} | null> => {
  const value = await cloudSaveEmulatorDestinationsSublevel.get(
    await bindingKey(game, rawPath, kind)
  );
  if (
    !value ||
    typeof value !== "object" ||
    !("path" in value) ||
    typeof value.path !== "string" ||
    !path.isAbsolute(value.path) ||
    !("canonicalPath" in value) ||
    typeof value.canonicalPath !== "string" ||
    !path.isAbsolute(value.canonicalPath) ||
    !("device" in value) ||
    typeof value.device !== "number" ||
    !("inode" in value) ||
    typeof value.inode !== "number" ||
    !("sampleRelativePath" in value) ||
    typeof value.sampleRelativePath !== "string"
  ) {
    return null;
  }
  return {
    path: value.path,
    canonicalPath: value.canonicalPath,
    device: value.device,
    inode: value.inode,
    sampleRelativePath: value.sampleRelativePath,
  };
};

export const getEmulatorDestinationBinding = async (
  game: Game,
  rawPath: string,
  kind: EmulatorDestinationKind
) => (await bindingRecord(game, rawPath, kind))?.path ?? null;

export const registerEmulatorDestinationBinding = async (
  game: Game,
  rawPath: string,
  kind: EmulatorDestinationKind,
  selectedPath: string,
  relativePath?: string
) => {
  if (kind !== "save" && kind !== "state") {
    throw new Error("cloud_save_emulator_destination_invalid");
  }
  const expected = await getExpectedEmulatorDestination(
    game,
    rawPath,
    kind,
    relativePath
  );
  if (!expected) {
    throw new Error("cloud_save_emulator_destination_config_unavailable");
  }
  if (!(await isSameExistingEmulatorDestination(selectedPath, expected))) {
    throw new Error("cloud_save_emulator_destination_config_mismatch");
  }
  const stat = await fs.lstat(expected);
  await cloudSaveEmulatorDestinationsSublevel.put(
    await bindingKey(game, rawPath, kind),
    {
      path: expected,
      canonicalPath: await fs.realpath(expected),
      device: stat.dev,
      inode: stat.ino,
      sampleRelativePath: relativePath ?? "",
    }
  );
};

export const removeEmulatorDestinationBinding = async (
  game: Game,
  rawPath: string,
  kind: EmulatorDestinationKind
) => {
  await cloudSaveEmulatorDestinationsSublevel.del(
    await bindingKey(game, rawPath, kind)
  );
};

type DestinationBinding = NonNullable<
  Awaited<ReturnType<typeof bindingRecord>>
>;
type BindingExpectation = {
  binding: DestinationBinding | null;
  expected: string | null;
};

const expectedBoundRoot = async (
  game: Game,
  target: Pick<
    ResolvedRestoreTarget,
    "rawPath" | "relativePath" | "restoreRootPath"
  >,
  cache: Map<string, Promise<BindingExpectation>>
) => {
  const kind = emulatorDestinationKindForFile(
    target.rawPath,
    target.relativePath
  );
  if (!kind) return { binding: null, verified: false };
  const key = JSON.stringify([target.rawPath, kind]);
  let pending = cache.get(key);
  if (!pending) {
    pending = (async () => {
      const binding = await bindingRecord(game, target.rawPath, kind);
      if (!binding) return { binding: null, expected: null };
      const expected = await getExpectedEmulatorDestination(
        game,
        target.rawPath,
        kind,
        binding.sampleRelativePath || target.relativePath
      ).catch(() => null);
      return { binding, expected };
    })();
    cache.set(key, pending);
  }
  const { binding, expected } = await pending;
  if (!binding) return { binding: null, verified: false };
  return {
    binding: binding.path,
    verified: await isCurrentEmulatorDestinationBinding(
      binding,
      expected,
      target.restoreRootPath
    ),
  };
};

export const isVerifiedEmulatorDestinationBinding = async (
  game: Game,
  rawPath: string,
  kind: EmulatorDestinationKind,
  relativePath: string,
  restoreRootPath: string
) => {
  if (emulatorDestinationKindForFile(rawPath, relativePath) !== kind) {
    return false;
  }
  const binding = await bindingRecord(game, rawPath, kind);
  return binding
    ? isCurrentEmulatorDestinationBinding(
        binding,
        restoreRootPath,
        restoreRootPath
      )
    : false;
};

export const verifiedEmulatorRestoreEntryIds = async (
  game: Game | null | undefined,
  targets: ResolvedRestoreTarget[]
): Promise<Set<string>> => {
  const approved = new Set<string>();
  if (!game) return approved;
  const cache = new Map<string, Promise<BindingExpectation>>();
  for (const target of targets) {
    if ((await expectedBoundRoot(game, target, cache)).verified) {
      approved.add(cloudSaveFileKey(target));
    }
  }
  return approved;
};

export const assertEmulatorDestinationBindingsCurrent = async (
  game: Game | null | undefined,
  targets: ResolvedRestoreTarget[]
) => {
  if (!game) return;
  const cache = new Map<string, Promise<BindingExpectation>>();
  for (const target of targets) {
    const state = await expectedBoundRoot(game, target, cache);
    if (state.binding && !state.verified) {
      throw new Error("cloud_save_emulator_destination_changed");
    }
  }
};
