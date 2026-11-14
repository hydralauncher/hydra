import { createHash } from "node:crypto";
import type { Dirent } from "node:fs";
import { promises as fs } from "node:fs";
import path from "node:path";

import type { UserLocationCoverage } from "@types";

import {
  safeRelativeSegments,
  shadps4SaveRawPath,
} from "./emulator-provider-identity.js";
import type {
  EmulatorDiscoveredFile,
  EmulatorProviderContext,
  EmulatorProviderDiscovery,
} from "./emulator-provider-types";
import {
  isShadps4BackupDir,
  isShadps4MountMarker,
  SHADPS4_USER_ID,
} from "./shadps4-save-layout.js";

export const SHADPS4_DISCOVERY_REVISION = "shadps4-v1";

const hash = (value: string) =>
  createHash("sha256").update(value).digest("hex");

const coverage = (
  rawPath: string,
  variantId: string,
  complete: boolean
): UserLocationCoverage => ({
  candidateId: hash(rawPath),
  ruleId: hash(JSON.stringify(["emulator", rawPath])),
  variantId,
  rawPath,
  selectedRoot: true,
  authority: "exact",
  outcome: complete ? "scanned" : "partial",
  enumeratedCompletely: complete,
  warningCodes: complete ? [] : ["emulator-location-partial"],
});

const missingCoverage = (
  rawPath: string,
  variantId: string
): UserLocationCoverage => ({
  ...coverage(rawPath, variantId, true),
  selectedRoot: false,
  outcome: "confirmed-missing",
});

export const shadps4UnresolvedCoverage = (
  reason: string
): UserLocationCoverage => ({
  candidateId: hash(reason),
  ruleId: hash("emulator:shadps4"),
  rawPath: "<emulator>/shadps4/unresolved",
  selectedRoot: false,
  authority: "inferred",
  outcome: "unresolved",
  enumeratedCompletely: false,
  warningCodes: [reason],
});

const lstatIfExists = (target: string) =>
  fs
    .lstat(target)
    .catch((error: NodeJS.ErrnoException) =>
      error.code === "ENOENT" ? null : undefined
    );

const listSafeFiles = async (root: string) => {
  const files: string[] = [];
  const stack = [root];
  let complete = true;
  while (stack.length) {
    const current = stack.pop()!;
    let entries: Dirent[];
    try {
      entries = await fs.readdir(current, { withFileTypes: true });
    } catch {
      complete = false;
      continue;
    }
    for (const entry of entries) {
      const target = path.join(current, entry.name);
      if (entry.isSymbolicLink()) complete = false;
      else if (entry.isDirectory()) stack.push(target);
      else if (entry.isFile()) files.push(target);
    }
  }
  return { files, complete };
};

const scanSaveTitle = async (
  titleRoot: string,
  rawPath: string,
  userId: string,
  { environmentId, variantId }: EmulatorProviderContext
) => {
  const files: EmulatorDiscoveredFile[] = [];
  const titleStat = await lstatIfExists(titleRoot);
  if (titleStat === null) {
    return { files, coverage: missingCoverage(rawPath, variantId) };
  }
  if (!titleStat?.isDirectory() || titleStat.isSymbolicLink()) {
    return { files, coverage: coverage(rawPath, variantId, false) };
  }
  const saves = await fs
    .readdir(titleRoot, { withFileTypes: true })
    .catch(() => null);
  if (!saves) return { files, coverage: coverage(rawPath, variantId, false) };

  let complete = true;
  for (const save of saves) {
    if (isShadps4BackupDir(save.name)) continue;
    if (save.isSymbolicLink()) {
      complete = false;
      continue;
    }
    if (!save.isDirectory()) continue;
    const scanned = await listSafeFiles(path.join(titleRoot, save.name));
    complete &&= scanned.complete;
    for (const absolutePath of scanned.files) {
      const relativePath = path
        .relative(titleRoot, absolutePath)
        .split(path.sep)
        .join("/");
      const segments = safeRelativeSegments(relativePath);
      if (!segments) {
        complete = false;
        continue;
      }
      if (isShadps4MountMarker(segments)) continue;
      files.push({
        variantId,
        ruleId: hash(JSON.stringify(["emulator", rawPath])),
        rawPath,
        absolutePath,
        relativePath,
        localBindings: {
          environmentId,
          rootId: hash(JSON.stringify([environmentId, titleRoot])),
          concreteUserSegment: userId,
          concretePath: titleRoot,
        },
        confidence: "exact",
        provenance: ["emulator:shadps4"],
      });
    }
  }
  return { files, coverage: coverage(rawPath, variantId, complete) };
};

export const scanShadps4SaveRoot = async (
  context: EmulatorProviderContext,
  homeRoot: string
): Promise<EmulatorProviderDiscovery> => {
  const result: EmulatorProviderDiscovery = {
    files: [],
    coverage: [],
    revision: SHADPS4_DISCOVERY_REVISION,
  };
  const saveTitleIds = context.savedataTitleIds ?? [];
  if (!saveTitleIds.length) {
    result.coverage.push(
      shadps4UnresolvedCoverage("shadps4-title-id-unresolved")
    );
    return result;
  }
  const users = await fs
    .readdir(homeRoot, { withFileTypes: true })
    .catch(() => null);
  if (!users) {
    result.coverage.push(shadps4UnresolvedCoverage("shadps4-users-unresolved"));
    return result;
  }
  for (const user of users.filter((entry) =>
    SHADPS4_USER_ID.test(entry.name)
  )) {
    const scanned = await scanUser(context, homeRoot, user, saveTitleIds);
    result.files.push(...scanned.files);
    result.coverage.push(...scanned.coverage);
  }
  return result;
};

const scanUser = async (
  context: EmulatorProviderContext,
  homeRoot: string,
  user: Dirent,
  saveTitleIds: readonly string[]
) => {
  const partial = () => ({
    files: [] as EmulatorDiscoveredFile[],
    coverage: saveTitleIds.map((saveTitleId) =>
      coverage(
        shadps4SaveRawPath(saveTitleId, user.name),
        context.variantId,
        false
      )
    ),
  });
  if (!user.isDirectory() || user.isSymbolicLink()) return partial();

  const savedataRoot = path.join(homeRoot, user.name, "savedata");
  const savedataStat = await lstatIfExists(savedataRoot);
  if (
    savedataStat === undefined ||
    savedataStat?.isSymbolicLink() ||
    (savedataStat && !savedataStat.isDirectory())
  ) {
    return partial();
  }

  const files: EmulatorDiscoveredFile[] = [];
  const coverageEntries: UserLocationCoverage[] = [];
  for (const saveTitleId of saveTitleIds) {
    const scanned = await scanSaveTitle(
      path.join(savedataRoot, saveTitleId),
      shadps4SaveRawPath(saveTitleId, user.name),
      user.name,
      context
    );
    files.push(...scanned.files);
    coverageEntries.push(scanned.coverage);
  }
  return { files, coverage: coverageEntries };
};
