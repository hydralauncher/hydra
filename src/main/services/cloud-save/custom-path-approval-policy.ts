import type { RestoreManifestFile } from "@types";

import { cloudSaveFileKey } from "./cloud-save-contract.js";
import { CLOUD_SAVE_CUSTOM_PATH_PREFIX } from "./custom-path.js";

export interface CloudSaveCustomPathRestoreCandidate {
  rawPath: string;
  files: RestoreManifestFile[];
}

export const getUnboundCloudSaveCustomPathRestoreCandidates = (
  files: RestoreManifestFile[],
  restoreEntryIds: Iterable<string>,
  locallyBoundRawPaths: Iterable<string>
): CloudSaveCustomPathRestoreCandidate[] => {
  const restoreIds = new Set(restoreEntryIds);
  const boundPaths = new Set(locallyBoundRawPaths);
  const filesByRawPath = new Map<string, RestoreManifestFile[]>();

  for (const file of files) {
    if (
      !file.rawPath.startsWith(CLOUD_SAVE_CUSTOM_PATH_PREFIX) ||
      boundPaths.has(file.rawPath) ||
      !restoreIds.has(cloudSaveFileKey(file))
    ) {
      continue;
    }

    const matchingFiles = filesByRawPath.get(file.rawPath) ?? [];
    matchingFiles.push(file);
    filesByRawPath.set(file.rawPath, matchingFiles);
  }

  return [...filesByRawPath.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([rawPath, matchingFiles]) => ({
      rawPath,
      files: matchingFiles,
    }));
};
