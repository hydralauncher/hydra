import { promises as fs } from "node:fs";
import path from "node:path";

import type { CloudSaveRule, Game, RestoreManifestFile } from "@types";

import {
  emulatorRestoreRule,
  parseRpcs3SavestateRawPath,
  safeRelativeSegments,
} from "./emulator-provider-identity.js";
import {
  rpcs3SavestateFileBelongsToTitle,
  rpcs3TitleIdsForGame,
} from "./rpcs3-save-layout.js";

const lstatIfExists = async (target: string) =>
  fs
    .lstat(target)
    .catch((error: NodeJS.ErrnoException) =>
      error.code === "ENOENT" ? null : undefined
    );

export const resolveRpcs3SavestateRestoreRule = async (
  game: Game,
  file: Pick<RestoreManifestFile, "rawPath" | "relativePath">,
  configRoot: string
): Promise<CloudSaveRule | null> => {
  const state = parseRpcs3SavestateRawPath(file.rawPath);
  if (!state || !rpcs3TitleIdsForGame(game).includes(state.titleId)) {
    return null;
  }
  const segments = safeRelativeSegments(file.relativePath);
  if (
    !segments ||
    segments.length !== 1 ||
    !rpcs3SavestateFileBelongsToTitle(segments[0], state.titleId)
  ) {
    return null;
  }
  const statesRoot = path.join(configRoot, "savestates");
  const titleRoot = path.join(statesRoot, state.titleId);
  const [statesStat, titleStat, targetStat] = await Promise.all([
    lstatIfExists(statesRoot),
    lstatIfExists(titleRoot),
    lstatIfExists(path.join(titleRoot, segments[0])),
  ]);
  if (
    statesStat === undefined ||
    titleStat === undefined ||
    targetStat === undefined ||
    (statesStat &&
      (!statesStat.isDirectory() || statesStat.isSymbolicLink())) ||
    (titleStat && (!titleStat.isDirectory() || titleStat.isSymbolicLink())) ||
    (targetStat && (!targetStat.isFile() || targetStat.isSymbolicLink()))
  ) {
    return null;
  }
  return emulatorRestoreRule(file.rawPath, titleRoot, "dir");
};
