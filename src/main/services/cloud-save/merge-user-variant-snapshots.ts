import type {
  CloudSaveConflictResolution,
  CloudSaveMergeResult,
  CloudSaveSyncAnchor,
  LocalGameSnapshotContext,
  SnapshotFile,
  SnapshotVariant,
} from "@types";

import { cloudSaveFileKey } from "./cloud-save-contract.js";
import type { SyncDirection } from "./sync-game/policy.js";

interface MergeUserVariantSnapshotsInput {
  local: LocalGameSnapshotContext;
  remoteVariants: SnapshotVariant[];
  remoteFiles: SnapshotFile[];
  base: CloudSaveSyncAnchor | null;
  direction?: SyncDirection;
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
  direction = "bidirectional",
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
  const deleteRemoteEntryIds = new Set<string>();
  const deleteLocalEntryIds = new Set<string>();
  const unresolvedRemoteEntryIds = new Set<string>();

  const coverageFor = (file: SnapshotFile) =>
    local.coverage.filter(
      (item) =>
        (!item.variantId || item.variantId === file.variantId) &&
        (!item.rawPath || item.rawPath === file.rawPath) &&
        (!item.relativePath || item.relativePath === file.relativePath)
    );
  const coverageStateFor = (file: SnapshotFile) => {
    const coverage = coverageFor(file);
    const incomplete = coverage.some(
      (item) =>
        !item.enumeratedCompletely ||
        item.outcome === "failed" ||
        item.outcome === "partial" ||
        item.outcome === "unresolved"
    );
    const selectedCompleteRoot = coverage.some(
      (item) =>
        item.selectedRoot &&
        item.outcome === "scanned" &&
        item.enumeratedCompletely
    );
    return {
      incomplete,
      provesDeletion: selectedCompleteRoot && !incomplete,
    };
  };

  for (const entryId of [...ids].sort()) {
    const localFile = localById.get(entryId);
    const remoteFile = remoteById.get(entryId);
    const baseEntry = baseById.get(entryId);

    if (localFile && !remoteFile) {
      if (!baseEntry) {
        files.push(localFile);
        continue;
      }
      if (sameBytes(localFile, baseEntry)) {
        deleteLocalEntryIds.add(entryId);
        continue;
      }
      const resolution = resolutions?.get(entryId);
      if (resolution === "keep-remote") {
        deleteLocalEntryIds.add(entryId);
      } else {
        files.push(localFile);
        if (!resolution) {
          conflicts.push({ entryId, local: localFile, remote: null });
        }
      }
      continue;
    }
    if (!localFile && remoteFile) {
      const coverage = coverageStateFor(remoteFile);
      if (!baseEntry || local.files.length === 0) {
        files.push(remoteFile);
        unresolvedRemoteEntryIds.add(entryId);
        if (local.files.length === 0 || !coverage.incomplete) {
          restoreEntryIds.add(entryId);
        }
        continue;
      }

      if (!coverage.provesDeletion) {
        files.push(remoteFile);
        unresolvedRemoteEntryIds.add(entryId);
        if (!coverage.incomplete) restoreEntryIds.add(entryId);
        continue;
      }

      if (sameBytes(remoteFile, baseEntry)) {
        if (direction === "restore-only") {
          files.push(remoteFile);
          restoreEntryIds.add(entryId);
        } else {
          deleteRemoteEntryIds.add(entryId);
        }
        continue;
      }

      const resolution = resolutions?.get(entryId);
      if (resolution === "keep-local") {
        deleteRemoteEntryIds.add(entryId);
      } else {
        files.push(remoteFile);
        if (resolution === "keep-remote") {
          restoreEntryIds.add(entryId);
        } else {
          conflicts.push({ entryId, local: null, remote: remoteFile });
        }
      }
      continue;
    }
    if (!localFile && !remoteFile) {
      continue;
    }
    if (!localFile || !remoteFile) {
      continue;
    }
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
    deleteRemoteEntryIds: [...deleteRemoteEntryIds].sort(),
    deleteLocalEntryIds: [...deleteLocalEntryIds].sort(),
    unresolvedRemoteEntryIds: [...unresolvedRemoteEntryIds].sort(),
    partial:
      incompleteCoverage ||
      unresolvedRemoteEntryIds.size > 0 ||
      (direction === "upload-only" && deleteLocalEntryIds.size > 0),
  };
};
