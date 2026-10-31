import { promises as fs } from "node:fs";
import path from "node:path";

import type { CloudSaveRule, RestoreManifestFile } from "@types";

import {
  emulatorRestoreRule,
  parseRpcs3GamedataRawPath,
  safeRelativeSegments,
} from "./emulator-provider-identity.js";
import { rpcs3GamedataFolderBelongsToTitle } from "./rpcs3-save-layout.js";
import { isSafeRpcs3RestoreTarget } from "./rpcs3-savedata-restore.js";

export const resolveRpcs3GamedataRestoreRule = async (
  file: Pick<RestoreManifestFile, "rawPath" | "relativePath">,
  allowedTitleIds: ReadonlySet<string>,
  hdd0Root: string
): Promise<CloudSaveRule | null> => {
  const parsed = parseRpcs3GamedataRawPath(file.rawPath);
  const segments = safeRelativeSegments(file.relativePath);
  if (
    !parsed ||
    !allowedTitleIds.has(parsed.titleId) ||
    !segments ||
    segments.length < 2 ||
    !rpcs3GamedataFolderBelongsToTitle(segments[0], parsed.titleId)
  ) {
    return null;
  }
  const hdd0 = await fs.lstat(hdd0Root).catch(() => null);
  if (!hdd0?.isDirectory() || hdd0.isSymbolicLink()) return null;
  const gameRoot = path.join(hdd0Root, "game");
  if (!(await isSafeRpcs3RestoreTarget(gameRoot, segments))) return null;
  const gameRootStat = await fs
    .lstat(gameRoot)
    .catch((error: NodeJS.ErrnoException) =>
      error.code === "ENOENT" ? null : undefined
    );
  if (
    gameRootStat === undefined ||
    (gameRootStat &&
      (!gameRootStat.isDirectory() || gameRootStat.isSymbolicLink()))
  ) {
    return null;
  }
  return emulatorRestoreRule(file.rawPath, gameRoot, "dir");
};
