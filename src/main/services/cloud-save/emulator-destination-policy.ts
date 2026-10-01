import { promises as fs } from "node:fs";
import path from "node:path";

import type { CloudSaveFileIdentity } from "@types";

import { cloudSaveFileKey } from "./cloud-save-contract.js";
import {
  parseRetroArchSaveRawPath,
  parseRpcs3SaveRawPath,
  parseRpcs3SavestateRawPath,
} from "./emulator-provider-identity.js";

export type EmulatorDestinationKind = "save" | "state";

export const emulatorDestinationKindForFile = (
  rawPath: string,
  relativePath: string
): EmulatorDestinationKind | null => {
  if (parseRetroArchSaveRawPath(rawPath)) {
    if (/^state\.state(?:\d+|\.auto)?(?:\.png)?$/.test(relativePath)) {
      return "state";
    }
    if (/^battery\.(?:srm|rtc|eep|sra|fla|mpk|sav)$/.test(relativePath)) {
      return "save";
    }
    return null;
  }
  if (parseRpcs3SavestateRawPath(rawPath)) return "state";
  if (parseRpcs3SaveRawPath(rawPath)) return "save";
  return null;
};

export const groupEmulatorRestoreDestinations = (
  files: readonly CloudSaveFileIdentity[],
  pending: ReadonlySet<string>,
  automatic: ReadonlySet<string>
) => {
  const grouped = new Map<
    string,
    {
      rawPath: string;
      kind: EmulatorDestinationKind;
      relativePath: string;
      fileCount: number;
      needsDestination: boolean;
    }
  >();
  for (const file of files) {
    const kind = emulatorDestinationKindForFile(
      file.rawPath,
      file.relativePath
    );
    if (!kind) continue;
    const key = JSON.stringify([file.rawPath, kind]);
    const group = grouped.get(key) ?? {
      rawPath: file.rawPath,
      kind,
      relativePath: file.relativePath,
      fileCount: 0,
      needsDestination: false,
    };
    group.fileCount += 1;
    const fileId = cloudSaveFileKey(file);
    group.needsDestination ||= pending.has(fileId) && !automatic.has(fileId);
    grouped.set(key, group);
  }
  return [...grouped.values()];
};

export const isSafeExistingEmulatorDestination = async (root: string) => {
  if (!path.isAbsolute(root)) return false;
  try {
    const stat = await fs.lstat(root);
    if (!stat.isDirectory() || stat.isSymbolicLink()) return false;
    await fs.realpath(root);
    return true;
  } catch {
    return false;
  }
};

export const isSameExistingEmulatorDestination = async (
  selected: string,
  configured: string
) => {
  if (
    !(await isSafeExistingEmulatorDestination(selected)) ||
    !(await isSafeExistingEmulatorDestination(configured))
  ) {
    return false;
  }
  const [selectedReal, configuredReal, selectedStat, configuredStat] =
    await Promise.all([
      fs.realpath(selected),
      fs.realpath(configured),
      fs.lstat(selected),
      fs.lstat(configured),
    ]);
  return (
    selectedReal === configuredReal &&
    selectedStat.dev === configuredStat.dev &&
    selectedStat.ino === configuredStat.ino
  );
};

export const isCurrentEmulatorDestinationBinding = async (
  binding: {
    path: string;
    canonicalPath: string;
    device: number;
    inode: number;
  },
  configuredRoot: string | null,
  restoreRoot: string
) => {
  if (
    configuredRoot !== binding.path ||
    path.resolve(restoreRoot) !== configuredRoot ||
    !(await isSafeExistingEmulatorDestination(configuredRoot))
  ) {
    return false;
  }
  const [real, stat] = await Promise.all([
    fs.realpath(configuredRoot).catch(() => null),
    fs.lstat(configuredRoot).catch(() => null),
  ]);
  return (
    real === binding.canonicalPath &&
    stat?.dev === binding.device &&
    stat?.ino === binding.inode
  );
};
