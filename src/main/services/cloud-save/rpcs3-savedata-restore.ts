import { promises as fs } from "node:fs";
import path from "node:path";

import type {
  CloudSaveRule,
  ResolvedRestoreTarget,
  RestoreManifestFile,
} from "@types";

import {
  emulatorRestoreRule,
  parseRpcs3SaveRawPath,
  safeRelativeSegments,
} from "./emulator-provider-identity.js";
import { rpcs3SlotBelongsToTitle } from "./rpcs3-save-layout.js";

export const isSafeRpcs3RestoreTarget = async (
  root: string,
  segments: string[]
) => {
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
  homeRoot: string
): Promise<CloudSaveRule | null> => {
  const parsed = parseRpcs3SaveRawPath(file.rawPath);
  const segments = safeRelativeSegments(file.relativePath);
  if (
    !parsed ||
    !allowedTitleIds.has(parsed.titleId) ||
    !segments ||
    segments.length < 2 ||
    !rpcs3SlotBelongsToTitle(segments[0], parsed.titleId)
  )
    return null;
  const home = await fs.lstat(homeRoot).catch(() => null);
  if (!home?.isDirectory() || home.isSymbolicLink()) return null;
  const profileRoot = path.join(homeRoot, parsed.profileId);
  const profile = await fs.lstat(profileRoot).catch(() => null);
  if (profile && !profile.isDirectory()) return null;
  if (
    !(await isSafeRpcs3RestoreTarget(homeRoot, [parsed.profileId, "savedata"]))
  ) {
    return null;
  }
  const saveRoot = path.join(profileRoot, "savedata");
  if (!(await isSafeRpcs3RestoreTarget(saveRoot, segments))) return null;
  return emulatorRestoreRule(file.rawPath, saveRoot, "dir");
};

const RPCS3_USERNAME_FILE = "localusername";

export const rpcs3DefaultUsername = (profileId: string) =>
  `User ${Number(profileId)}`;

export const ensureRpcs3RestoredUserNames = async (
  actions: Pick<ResolvedRestoreTarget, "rawPath" | "restoreRootPath">[]
) => {
  const profiles = new Map<string, string>();
  for (const action of actions) {
    const parsed = parseRpcs3SaveRawPath(action.rawPath);
    if (!parsed || path.basename(action.restoreRootPath) !== "savedata") {
      continue;
    }
    const profileRoot = path.dirname(action.restoreRootPath);
    if (path.basename(profileRoot) !== parsed.profileId) continue;
    profiles.set(profileRoot, parsed.profileId);
  }
  await Promise.all(
    [...profiles].map(async ([profileRoot, profileId]) => {
      const profile = await fs.lstat(profileRoot).catch(() => null);
      if (!profile?.isDirectory() || profile.isSymbolicLink()) return;
      await fs
        .writeFile(
          path.join(profileRoot, RPCS3_USERNAME_FILE),
          rpcs3DefaultUsername(profileId),
          { flag: "wx" }
        )
        .catch((error: NodeJS.ErrnoException) => {
          if (error.code !== "EEXIST") throw error;
        });
    })
  );
};
