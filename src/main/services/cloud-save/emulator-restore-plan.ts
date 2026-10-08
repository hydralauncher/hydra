import { promises as fs } from "node:fs";
import path from "node:path";

import type {
  CloudSavePathContext,
  ResolvedRestoreTarget,
  ResolveRestoreTargetsResult,
} from "@types";

import {
  isEmulatorSaveRawPath,
  parseRpcs3GamedataRawPath,
  parseRpcs3SaveRawPath,
} from "./emulator-provider-identity.js";

const within = (root: string, candidate: string) => {
  const relative = path.relative(root, candidate);
  return (
    relative !== "" &&
    relative !== ".." &&
    !relative.startsWith(`..${path.sep}`) &&
    !path.isAbsolute(relative)
  );
};

const lstatIfExists = async (target: string) =>
  fs.lstat(target).catch((error: NodeJS.ErrnoException) => {
    if (error.code === "ENOENT") return null;
    throw error;
  });

const restoreBaseForRoot = (root: string, rawPath: string) => {
  const rpcs3Save = parseRpcs3SaveRawPath(rawPath);
  if (
    rpcs3Save &&
    path.basename(root) === "savedata" &&
    path.basename(path.dirname(root)) === rpcs3Save.profileId
  ) {
    return path.dirname(path.dirname(root));
  }
  if (parseRpcs3GamedataRawPath(rawPath) && path.basename(root) === "game") {
    return path.dirname(root);
  }
  return root;
};

const targetPathIsSafe = async (
  action: ResolvedRestoreTarget,
  context: CloudSavePathContext
) => {
  const root = path.resolve(action.restoreRootPath);
  const target = path.resolve(action.targetPath);
  if (
    !path.isAbsolute(action.restoreRootPath) ||
    !path.isAbsolute(action.targetPath) ||
    !within(root, target)
  ) {
    return false;
  }

  const home = path.resolve(context.homeDir);
  const isHomeTarget = root === home || within(home, root);
  const base = isHomeTarget ? home : restoreBaseForRoot(root, action.rawPath);
  const baseStat = await lstatIfExists(base);
  if (!baseStat?.isDirectory() || baseStat.isSymbolicLink()) return false;
  const canonicalBase = (await fs.realpath(base)).normalize("NFC");
  const configuredBase = base.normalize("NFC");
  if (
    (context.platform === "linux"
      ? canonicalBase
      : canonicalBase.toLowerCase()) !==
    (context.platform === "linux"
      ? configuredBase
      : configuredBase.toLowerCase())
  ) {
    return false;
  }

  let current = base;
  let missing = false;
  for (const segment of path.relative(base, target).split(path.sep)) {
    current = path.join(current, segment);
    const stat = missing ? null : await lstatIfExists(current);
    if (!stat) {
      missing = true;
      continue;
    }
    if (stat.isSymbolicLink() || stat.dev !== baseStat.dev) return false;
    if (current === target ? !stat.isFile() : !stat.isDirectory()) {
      return false;
    }
  }
  return true;
};

/** Apply the provider's exact game targets as one restore plan. */
export const filterUnsafeEmulatorRestoreTargets = async (
  isEmulatorGame: boolean,
  pathContext: CloudSavePathContext,
  resolution: ResolveRestoreTargetsResult
): Promise<ResolveRestoreTargetsResult> => {
  if (!isEmulatorGame) return resolution;

  const actions: ResolveRestoreTargetsResult["actions"] = [];
  const blocked = [...resolution.blocked];
  for (const action of resolution.actions) {
    if (
      !isEmulatorSaveRawPath(action.rawPath) ||
      (await targetPathIsSafe(action, pathContext).catch(() => false))
    ) {
      actions.push(action);
      continue;
    }
    blocked.push({
      variantId: action.variantId,
      rawPath: action.rawPath,
      relativePath: action.relativePath,
      hash: action.hash,
      sizeBytes: action.sizeBytes,
      lastModifiedAt: action.lastModifiedAt,
      reason: "blocked-emulator-destination-unavailable",
    });
  }
  return { ...resolution, actions, blocked };
};

export const assertRestorePlanUnchanged = (
  before: ResolveRestoreTargetsResult,
  after: ResolveRestoreTargetsResult
) => {
  const signature = (plan: ResolveRestoreTargetsResult) =>
    JSON.stringify({
      actions: plan.actions
        .map((action) => ({
          id: [action.variantId, action.rawPath, action.relativePath],
          targetPath: action.targetPath,
          restoreRootPath: action.restoreRootPath,
          action: action.action,
          observedHash: action.observedHash ?? null,
          observedSizeBytes: action.observedSizeBytes ?? null,
          observedLastModifiedAt: action.observedLastModifiedAt ?? null,
        }))
        .sort((left, right) =>
          JSON.stringify(left.id).localeCompare(JSON.stringify(right.id))
        ),
      blocked: plan.blocked
        .map((file) => [
          file.variantId,
          file.rawPath,
          file.relativePath,
          file.reason,
        ])
        .sort(),
      deferred: plan.deferred
        .map((file) => [
          file.variantId,
          file.rawPath,
          file.relativePath,
          file.reason,
        ])
        .sort(),
    });
  if (signature(before) !== signature(after)) {
    throw new Error("cloud_save_restore_destination_changed");
  }
};
