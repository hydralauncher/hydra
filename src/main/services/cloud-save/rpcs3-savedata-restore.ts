import { promises as fs } from "node:fs";
import path from "node:path";

import type { CloudSaveRule, RestoreManifestFile } from "@types";

import {
  emulatorRestoreRule,
  parseRpcs3SaveRawPath,
  safeRelativeSegments,
} from "./emulator-provider-identity.js";
import { rpcs3SlotBelongsToTitle } from "./rpcs3-save-layout.js";

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

export const resolveRpcs3SavedataRestoreRule = async (
  file: Pick<RestoreManifestFile, "rawPath" | "relativePath">,
  allowedTitleIds: ReadonlySet<string>,
  homeRoot: string,
  activeProfileId: string,
  cloudProfileId: string | undefined
): Promise<CloudSaveRule | null> => {
  const parsed = parseRpcs3SaveRawPath(file.rawPath);
  const segments = safeRelativeSegments(file.relativePath);
  if (
    !parsed ||
    parsed.profileId !== cloudProfileId ||
    !allowedTitleIds.has(parsed.titleId) ||
    !segments ||
    segments.length < 2 ||
    !rpcs3SlotBelongsToTitle(segments[0], parsed.titleId)
  )
    return null;
  const profileRoot = path.join(homeRoot, activeProfileId);
  const profile = await fs.lstat(profileRoot).catch(() => null);
  if (!profile?.isDirectory() || profile.isSymbolicLink()) return null;
  const saveRoot = path.join(profileRoot, "savedata");
  const saveRootStat = await fs.lstat(saveRoot).catch(() => null);
  if (saveRootStat?.isSymbolicLink()) return null;
  if (!(await isSafeTarget(saveRoot, segments))) return null;
  return emulatorRestoreRule(file.rawPath, saveRoot, "dir");
};
