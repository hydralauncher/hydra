import type {
  DownloadedRestoreFile,
  ReplaceRestoreTarget,
  ReplaceRestoreTargetsResult,
  ResolvedRestoreTarget,
  RestoreManifestFile,
} from "@types";

import { cloudSaveFileKey } from "./cloud-save-contract.js";

export const selectRestoreFiles = (
  files: RestoreManifestFile[],
  requestedEntryIds?: readonly string[]
) => {
  if (!requestedEntryIds) return files;
  const requestedIds = new Set(requestedEntryIds);
  const selectedFiles = files.filter((file) =>
    requestedIds.has(cloudSaveFileKey(file))
  );
  if (selectedFiles.length !== requestedIds.size) {
    throw new Error("Requested restore file is missing from manifest");
  }
  return selectedFiles;
};

const getRestoreDownloadSource = (
  target: RestoreManifestFile,
  sourceFilesByEntryId?: ReadonlyMap<string, RestoreManifestFile>
) => {
  const source = sourceFilesByEntryId
    ? sourceFilesByEntryId.get(cloudSaveFileKey(target))
    : target;
  if (!source) throw new Error("Missing restore download source file");
  if (
    source.hash !== target.hash ||
    source.sizeBytes !== target.sizeBytes ||
    source.lastModifiedAt !== target.lastModifiedAt
  ) {
    throw new Error(
      "Restore download source file does not match resolved target"
    );
  }
  return source;
};

export const resolveRestoreDownloadSources = (
  targets: RestoreManifestFile[],
  sourceFilesByEntryId?: ReadonlyMap<string, RestoreManifestFile>
) =>
  targets.map((target) =>
    getRestoreDownloadSource(target, sourceFilesByEntryId)
  );

const replacementIdentity = ({
  variantId,
  rawPath,
  relativePath,
  targetPath,
  restoreRootPath,
  lastModifiedAt,
}: ResolvedRestoreTarget) => ({
  variantId,
  rawPath,
  relativePath,
  targetPath,
  restoreRootPath,
  lastModifiedAt,
});

export const buildRestoreReplacements = (
  actions: ResolvedRestoreTarget[],
  downloadedFiles: DownloadedRestoreFile[],
  sourceFilesByEntryId?: ReadonlyMap<string, RestoreManifestFile>
): ReplaceRestoreTarget[] => {
  const downloadedById = new Map(
    downloadedFiles.map((file) => [cloudSaveFileKey(file), file] as const)
  );

  return actions.map((target) => {
    if (target.action === "skip-identical") {
      return {
        ...replacementIdentity(target),
        action: "skip",
        expectedHash: target.hash,
      };
    }
    const source = getRestoreDownloadSource(target, sourceFilesByEntryId);
    const downloaded = downloadedById.get(cloudSaveFileKey(source));
    if (!downloaded) throw new Error("Missing downloaded restore file");
    if (
      downloaded.hash !== target.hash ||
      downloaded.sizeBytes !== target.sizeBytes ||
      downloaded.lastModifiedAt !== target.lastModifiedAt
    ) {
      throw new Error("Downloaded restore file does not match resolved target");
    }
    return {
      ...replacementIdentity(target),
      action: "restore",
      tempPath: downloaded.tempPath,
      expectedHash: target.hash,
    };
  });
};

export const isRestoreReplacementSuccessful = (
  result: ReplaceRestoreTargetsResult,
  expectedTargetCount: number
) =>
  result.failedFiles.length === 0 &&
  result.restoredFiles.length + result.skippedFiles.length ===
    expectedTargetCount;
