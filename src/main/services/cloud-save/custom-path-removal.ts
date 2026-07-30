import type {
  CloudSaveMergeResult,
  CloudSaveSyncAnchor,
  LocalGameSnapshot,
  RestoreManifestResponse,
} from "@types";

import { cloudSaveFileKey } from "./cloud-save-contract.js";
import type { SyncDirection } from "./sync-game/policy.js";

interface CloudSaveRawPathRemovalAnalysis {
  localSnapshot: Pick<LocalGameSnapshot, "files" | "coverage">;
  remoteManifest: Pick<RestoreManifestResponse, "files"> | null;
  anchor: Pick<CloudSaveSyncAnchor, "entries"> | null;
  syncDirection: SyncDirection;
}

const isIncompleteCoverage = (
  coverage: LocalGameSnapshot["coverage"][number]
) =>
  !coverage.enumeratedCompletely ||
  coverage.outcome === "failed" ||
  coverage.outcome === "partial" ||
  coverage.outcome === "unresolved";

export const isCloudSaveRawPathRemovable = (
  rawPath: string,
  registeredRawPaths: ReadonlySet<string>,
  activeRemoteFiles: ReadonlyArray<{ rawPath: string }>
) =>
  registeredRawPaths.has(rawPath) ||
  activeRemoteFiles.some((file) => file.rawPath === rawPath);

export const excludeCloudSaveRawPathsFromMerge = (
  analysis: CloudSaveRawPathRemovalAnalysis,
  merge: CloudSaveMergeResult,
  rawPaths: ReadonlySet<string>
): CloudSaveMergeResult => {
  if (rawPaths.size === 0) return merge;

  const knownFiles = [
    ...analysis.localSnapshot.files,
    ...(analysis.remoteManifest?.files ?? []),
    ...(analysis.anchor?.entries ?? []),
  ];
  const excludedEntryIds = new Set(
    knownFiles
      .filter((file) => rawPaths.has(file.rawPath))
      .map(cloudSaveFileKey)
  );
  const remoteEntryIds = (analysis.remoteManifest?.files ?? [])
    .filter((file) => rawPaths.has(file.rawPath))
    .map(cloudSaveFileKey);
  const files = merge.files.filter((file) => !rawPaths.has(file.rawPath));
  const usedVariantIds = new Set(files.map((file) => file.variantId));
  const filterEntryIds = (entryIds: string[]) =>
    entryIds.filter((entryId) => !excludedEntryIds.has(entryId));
  const unresolvedRemoteEntryIds = filterEntryIds(
    merge.unresolvedRemoteEntryIds
  );
  const deleteLocalEntryIds = filterEntryIds(merge.deleteLocalEntryIds);
  const incompleteCoverage = analysis.localSnapshot.coverage.some(
    (coverage) =>
      (!coverage.rawPath || !rawPaths.has(coverage.rawPath)) &&
      isIncompleteCoverage(coverage)
  );

  return {
    variants: merge.variants.filter((variant) =>
      usedVariantIds.has(variant.variantId)
    ),
    files,
    conflicts: merge.conflicts.filter(
      (conflict) => !excludedEntryIds.has(conflict.entryId)
    ),
    restoreEntryIds: filterEntryIds(merge.restoreEntryIds),
    deleteRemoteEntryIds: [
      ...new Set([
        ...filterEntryIds(merge.deleteRemoteEntryIds),
        ...remoteEntryIds,
      ]),
    ].sort(),
    deleteLocalEntryIds,
    unresolvedRemoteEntryIds,
    partial:
      incompleteCoverage ||
      unresolvedRemoteEntryIds.length > 0 ||
      (analysis.syncDirection === "upload-only" &&
        deleteLocalEntryIds.length > 0),
  };
};
