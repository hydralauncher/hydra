import type {
  CloudSaveConflictResolution,
  CloudSaveMergeResult,
  CloudSaveSyncAnchor,
  LocalGameSnapshotContext,
  SnapshotFile,
  SnapshotVariant,
} from "@types";

import { cloudSaveFileKey } from "./cloud-save-contract.js";

interface MergeUserVariantSnapshotsInput {
  local: LocalGameSnapshotContext;
  remoteVariants: SnapshotVariant[];
  remoteFiles: SnapshotFile[];
  base: CloudSaveSyncAnchor | null;
  resolutions?: ReadonlyMap<string, CloudSaveConflictResolution>;
}

const indexUnique = <T extends SnapshotFile>(files: T[]) => {
  const result = new Map<string, T>();
  for (const file of files) {
    const key = cloudSaveFileKey(file);
    if (result.has(key)) {
      throw new Error("Duplicate composite Cloud Save file identity");
    }
    result.set(key, file);
  }
  return result;
};

const sameBytes = (
  left: Pick<SnapshotFile, "hash" | "sizeBytes"> | undefined,
  right: Pick<SnapshotFile, "hash" | "sizeBytes"> | undefined
) =>
  Boolean(
    left &&
      right &&
      left.hash === right.hash &&
      left.sizeBytes === right.sizeBytes
  );

const mergeVariantMetadata = (
  local: SnapshotVariant[],
  remote: SnapshotVariant[],
  usedVariantIds: Set<string>
) => {
  const variants = new Map<string, SnapshotVariant>();
  for (const variant of [...local, ...remote]) {
    const current = variants.get(variant.variantId);
    if (current && JSON.stringify(current) !== JSON.stringify(variant)) {
      throw new Error("Divergent Cloud Save metadata for the same variant");
    }
    variants.set(variant.variantId, variant);
  }
  return [...usedVariantIds].sort().map((variantId) => {
    const variant = variants.get(variantId);
    if (!variant) throw new Error("Cloud Save file has no variant metadata");
    return variant;
  });
};

export const mergeUserVariantSnapshots = ({
  local,
  remoteVariants,
  remoteFiles,
  base,
  resolutions,
}: MergeUserVariantSnapshotsInput): CloudSaveMergeResult => {
  const localById = indexUnique(local.files);
  const remoteById = indexUnique(remoteFiles);
  const baseById = new Map(
    (base?.entries ?? []).map((entry) => [cloudSaveFileKey(entry), entry])
  );
  const ids = new Set([...localById.keys(), ...remoteById.keys()]);
  const files: SnapshotFile[] = [];
  const conflicts: CloudSaveMergeResult["conflicts"] = [];
  const restoreEntryIds = new Set<string>();
  const unresolvedRemoteEntryIds = new Set<string>();

  const coverageIncompleteFor = (file: SnapshotFile) =>
    local.coverage.some(
      (item) =>
        (!item.variantId || item.variantId === file.variantId) &&
        (!item.rawPath || item.rawPath === file.rawPath) &&
        (!item.relativePath || item.relativePath === file.relativePath) &&
        (!item.enumeratedCompletely ||
          item.outcome === "failed" ||
          item.outcome === "partial" ||
          item.outcome === "unresolved")
    );

  for (const entryId of [...ids].sort()) {
    const localFile = localById.get(entryId);
    const remoteFile = remoteById.get(entryId);
    const baseEntry = baseById.get(entryId);

    if (localFile && !remoteFile) {
      files.push(localFile);
      continue;
    }
    if (!localFile && remoteFile) {
      files.push(remoteFile);
      unresolvedRemoteEntryIds.add(entryId);
      if (!coverageIncompleteFor(remoteFile)) {
        restoreEntryIds.add(entryId);
      }
      continue;
    }
    if (!localFile || !remoteFile) continue;
    if (sameBytes(localFile, remoteFile)) {
      files.push(remoteFile);
      continue;
    }

    const localEqualsBase = sameBytes(localFile, baseEntry);
    const remoteEqualsBase = sameBytes(remoteFile, baseEntry);
    if (baseEntry && remoteEqualsBase && !localEqualsBase) {
      files.push(localFile);
      continue;
    }
    if (baseEntry && localEqualsBase && !remoteEqualsBase) {
      files.push(remoteFile);
      restoreEntryIds.add(entryId);
      continue;
    }

    const resolution = resolutions?.get(entryId);
    if (resolution === "keep-local") {
      files.push(localFile);
    } else {
      files.push(remoteFile);
      if (resolution === "keep-remote") {
        restoreEntryIds.add(entryId);
      } else {
        conflicts.push({ entryId, local: localFile, remote: remoteFile });
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
  const usedVariantIds = new Set(files.map((file) => file.variantId));
  return {
    variants: mergeVariantMetadata(
      local.variants,
      remoteVariants,
      usedVariantIds
    ),
    files,
    conflicts,
    restoreEntryIds: [...restoreEntryIds].sort(),
    unresolvedRemoteEntryIds: [...unresolvedRemoteEntryIds].sort(),
    partial: incompleteCoverage || unresolvedRemoteEntryIds.size > 0,
  };
};
