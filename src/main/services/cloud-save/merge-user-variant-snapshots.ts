import type {
  CloudSaveConflictResolution,
  CloudSaveMergeResult,
  CloudSaveSyncAnchor,
  LocalGameSnapshotContext,
  UserVariantSnapshotFile,
} from "@types";

interface MergeUserVariantSnapshotsInput {
  local: LocalGameSnapshotContext;
  remoteFiles: UserVariantSnapshotFile[];
  base: CloudSaveSyncAnchor | null;
  resolutions?: ReadonlyMap<string, CloudSaveConflictResolution>;
}

const indexUnique = <T extends { logicalFileId: string }>(files: T[]) => {
  const result = new Map<string, T>();
  for (const file of files) {
    if (result.has(file.logicalFileId)) {
      throw new Error("Duplicate logical file ID in Cloud Save merge input");
    }
    result.set(file.logicalFileId, file);
  }
  return result;
};

export const mergeUserVariantSnapshots = ({
  local,
  remoteFiles,
  base,
  resolutions,
}: MergeUserVariantSnapshotsInput): CloudSaveMergeResult => {
  const localById = indexUnique(local.files);
  const remoteById = indexUnique(remoteFiles);
  const baseById = new Map(
    (base?.entries ?? []).map((entry) => [entry.logicalFileId, entry])
  );
  const ids = new Set([...localById.keys(), ...remoteById.keys()]);
  const files: UserVariantSnapshotFile[] = [];
  const conflicts: CloudSaveMergeResult["conflicts"] = [];
  const restoreEntryIds = new Set<string>();
  const unresolvedRemoteEntryIds = new Set<string>();
  const unavailableLocalEntryIds = new Set(
    local.coverage.flatMap((item) =>
      item.logicalFileId &&
      (!item.enumeratedCompletely ||
        item.outcome === "failed" ||
        item.outcome === "partial")
        ? [item.logicalFileId]
        : []
    )
  );

  for (const logicalFileId of [...ids].sort()) {
    const localFile = localById.get(logicalFileId);
    const remoteFile = remoteById.get(logicalFileId);
    const baseEntry = baseById.get(logicalFileId);

    if (localFile && !remoteFile) {
      files.push(localFile);
      continue;
    }
    if (!localFile && remoteFile) {
      files.push(remoteFile);
      if (!unavailableLocalEntryIds.has(logicalFileId)) {
        restoreEntryIds.add(logicalFileId);
      }
      unresolvedRemoteEntryIds.add(logicalFileId);
      continue;
    }
    if (!localFile || !remoteFile) continue;
    if (
      localFile.variantId !== remoteFile.variantId ||
      localFile.ruleId !== remoteFile.ruleId
    ) {
      throw new Error("Cloud Save logical identity metadata is inconsistent");
    }
    if (
      localFile.contentHash === remoteFile.contentHash &&
      localFile.sizeBytes === remoteFile.sizeBytes
    ) {
      files.push(remoteFile);
      continue;
    }

    const localEqualsBase =
      baseEntry?.contentHash === localFile.contentHash &&
      baseEntry.sizeBytes === localFile.sizeBytes;
    const remoteEqualsBase =
      baseEntry?.contentHash === remoteFile.contentHash &&
      baseEntry.sizeBytes === remoteFile.sizeBytes;
    if (baseEntry && remoteEqualsBase && !localEqualsBase) {
      files.push(localFile);
      continue;
    }
    if (baseEntry && localEqualsBase && !remoteEqualsBase) {
      files.push(remoteFile);
      restoreEntryIds.add(logicalFileId);
      continue;
    }

    const resolution = resolutions?.get(logicalFileId);
    if (resolution === "keep-local") {
      files.push(localFile);
    } else {
      files.push(remoteFile);
      if (resolution === "keep-remote") {
        restoreEntryIds.add(logicalFileId);
      } else {
        conflicts.push({ logicalFileId, local: localFile, remote: remoteFile });
      }
    }
  }

  const incompleteCoverage = local.coverage.some(
    (item) =>
      !item.enumeratedCompletely ||
      item.outcome === "failed" ||
      item.outcome === "partial" ||
      item.outcome === "unresolved"
  );
  return {
    files,
    conflicts,
    restoreEntryIds: [...restoreEntryIds].sort(),
    unresolvedRemoteEntryIds: [...unresolvedRemoteEntryIds].sort(),
    partial: incompleteCoverage || unresolvedRemoteEntryIds.size > 0,
  };
};
