import { createHash } from "node:crypto";
import type { Dirent } from "node:fs";
import { promises as fs } from "node:fs";
import path from "node:path";

import type { UserLocationCoverage } from "@types";

export const emulatorPathHash = (value: string) =>
  createHash("sha256").update(value).digest("hex");

export const emulatorRuleId = (rawPath: string) =>
  emulatorPathHash(JSON.stringify(["emulator", rawPath]));

export const emulatorCoverage = (
  rawPath: string,
  variantId: string,
  complete: boolean,
  warningCode: string
): UserLocationCoverage => ({
  candidateId: emulatorPathHash(rawPath),
  ruleId: emulatorRuleId(rawPath),
  variantId,
  rawPath,
  selectedRoot: true,
  authority: "exact",
  outcome: complete ? "scanned" : "partial",
  enumeratedCompletely: complete,
  warningCodes: complete ? [] : [warningCode],
});

export const emulatorUnresolvedCoverage = (
  provider: string,
  warningCode: string
): UserLocationCoverage => ({
  candidateId: emulatorPathHash(warningCode),
  ruleId: emulatorPathHash(`emulator:${provider}`),
  rawPath: `<emulator>/${provider}/unresolved`,
  selectedRoot: false,
  authority: "inferred",
  outcome: "unresolved",
  enumeratedCompletely: false,
  warningCodes: [warningCode],
});

export const lstatIfExists = async (target: string) =>
  fs.lstat(target).catch((error: NodeJS.ErrnoException) => {
    if (error.code === "ENOENT") return null;
    throw error;
  });

export const readDirectoryIfExists = async (
  target: string
): Promise<Dirent[] | null> => {
  const stat = await lstatIfExists(target);
  if (!stat) return null;
  if (!stat.isDirectory() || stat.isSymbolicLink()) {
    throw new Error("emulator_save_unsafe_directory");
  }
  return fs.readdir(target, { withFileTypes: true });
};

export const listSafeFiles = async (root: string) => {
  const files: string[] = [];
  const stack = [root];
  let complete = true;
  while (stack.length) {
    const current = stack.pop()!;
    const entries = await readDirectoryIfExists(current).catch(() => undefined);
    if (!entries) {
      complete = false;
      continue;
    }
    for (const entry of entries) {
      const target = path.join(current, entry.name);
      if (entry.isSymbolicLink()) {
        complete = false;
      } else if (entry.isDirectory()) {
        stack.push(target);
      } else if (entry.isFile()) {
        files.push(target);
      } else {
        complete = false;
      }
    }
  }
  return { files, complete };
};

export const safeRestorePath = async (root: string, segments: string[]) => {
  try {
    const rootStat = await lstatIfExists(root);
    if (rootStat && (!rootStat.isDirectory() || rootStat.isSymbolicLink())) {
      return false;
    }
  } catch {
    return false;
  }
  let current = root;
  for (const segment of segments) {
    current = path.join(current, segment);
    let stat: Awaited<ReturnType<typeof lstatIfExists>>;
    try {
      stat = await lstatIfExists(current);
    } catch {
      return false;
    }
    if (stat?.isSymbolicLink()) return false;
  }
  return true;
};
