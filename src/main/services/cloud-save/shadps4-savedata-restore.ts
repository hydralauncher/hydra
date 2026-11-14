import { promises as fs } from "node:fs";
import path from "node:path";

import type { CloudSaveRule, RestoreManifestFile } from "@types";

import {
  emulatorRestoreRule,
  parseShadps4SaveRawPath,
  safeRelativeSegments,
} from "./emulator-provider-identity.js";
import { isSafeEmulatorRestoreTarget } from "./emulator-safe-restore-target.js";
import { isShadps4SyncedSaveFile } from "./shadps4-save-layout.js";

export const resolveShadps4SavedataRestoreRule = async (
  file: Pick<RestoreManifestFile, "rawPath" | "relativePath">,
  allowedSaveTitleIds: ReadonlySet<string>,
  homeRoot: string
): Promise<CloudSaveRule | null> => {
  const parsed = parseShadps4SaveRawPath(file.rawPath);
  const segments = safeRelativeSegments(file.relativePath);
  if (
    !parsed ||
    !allowedSaveTitleIds.has(parsed.saveTitleId) ||
    !segments ||
    !isShadps4SyncedSaveFile(segments)
  ) {
    return null;
  }
  const home = await fs.lstat(homeRoot).catch(() => null);
  if (!home?.isDirectory() || home.isSymbolicLink()) return null;
  const titleRoot = path.join(
    homeRoot,
    parsed.userId,
    "savedata",
    parsed.saveTitleId
  );
  if (
    !(await isSafeEmulatorRestoreTarget(homeRoot, [
      parsed.userId,
      "savedata",
      parsed.saveTitleId,
    ])) ||
    !(await isSafeEmulatorRestoreTarget(titleRoot, segments))
  ) {
    return null;
  }
  return emulatorRestoreRule(file.rawPath, titleRoot, "dir");
};
