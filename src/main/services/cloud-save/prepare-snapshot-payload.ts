import type { PrepareSnapshotRequest } from "@types";

export const buildPrepareSnapshotPayload = ({
  shop,
  objectId,
  platform,
  hostname,
  snapshotHash,
  baseVersion,
  variants,
  files,
}: PrepareSnapshotRequest): PrepareSnapshotRequest => ({
  shop,
  objectId,
  platform,
  ...(hostname ? { hostname } : {}),
  snapshotHash,
  baseVersion,
  variants,
  files,
});
