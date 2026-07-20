import type { CloudSaveSyncAnchor } from "@types";

export const canMigrateLegacyCloudSaveAnchor = (
  anchor: CloudSaveSyncAnchor | null,
  localSnapshotHash: string,
  localSnapshotFileCount: number
) =>
  anchor !== null &&
  localSnapshotFileCount > 0 &&
  localSnapshotHash === anchor.baseAggregateHash;
