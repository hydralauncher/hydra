import type {
  DownloadedRestoreFile,
  ReplaceRestoreTarget,
  ReplaceRestoreTargetsResult,
  ResolvedRestoreTarget,
} from "@types";

import { cloudSaveFileKey } from "./cloud-save-contract.js";

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
  downloadedFiles: DownloadedRestoreFile[]
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
    const downloaded = downloadedById.get(cloudSaveFileKey(target));
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
  result: ReplaceRestoreTargetsResult
) => result.failedFiles.length === 0 && result.metadataFailures.length === 0;
