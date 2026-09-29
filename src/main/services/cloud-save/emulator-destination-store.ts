import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";

import {
  cloudSaveEmulatorDestinationsSublevel,
  db,
  levelKeys,
} from "@main/level";
import type { Game, RestoreManifestFile, User } from "@types";

import {
  getEmulatorRestoreRules,
  getEmulatorSaveProvider,
} from "./emulator-save-provider.js";
import {
  emulatorSaveFileKey,
  parseRetroArchSaveRawPath,
  parseRpcs3SavestateRawPath,
} from "./emulator-provider-identity.js";
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
    provider === "rpcs3" &&
    /^<emulator>\/rpcs3\//.test(rawPath)
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
