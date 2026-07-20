import { HydraApi } from "@main/services/hydra-api";
import type {
  CloudSaveUploadProgress,
  CommitSnapshotResponse,
  GameShop,
  LocalGameSnapshotContext,
  RemoteGameSnapshot,
} from "@types";

import { saveCloudSaveSyncAnchor } from "./sync-anchor";
import { uploadLocalGameSnapshot } from "./upload-local-game-snapshot";
import { buildLocalGameSnapshotContext } from "./build-local-game-snapshot";

type ProgressCallback = (progress: CloudSaveUploadProgress) => void;

const validateCommitResponse = (value: unknown): CommitSnapshotResponse => {
  if (!value || typeof value !== "object") {
    throw new Error("Invalid commit snapshot response");
  }

  const response = value as Record<string, unknown>;
  if (
    typeof response.snapshotId !== "string" ||
    response.snapshotId.length === 0 ||
    response.status !== "active" ||
    typeof response.fileCount !== "number" ||
    !Number.isInteger(response.fileCount) ||
    response.fileCount < 0 ||
    typeof response.totalSizeBytes !== "number" ||
    !Number.isFinite(response.totalSizeBytes) ||
    response.totalSizeBytes < 0 ||
    typeof response.aggregateHash !== "string" ||
    response.aggregateHash.length === 0
  ) {
    throw new Error("Invalid commit snapshot response");
  }

  return response as unknown as CommitSnapshotResponse;
};

export const createRemoteSnapshotFromLocalState = async (
  objectId: string,
  shop: GameShop,
  onProgress?: ProgressCallback,
  localSnapshotContext?: LocalGameSnapshotContext
): Promise<RemoteGameSnapshot | null> => {
  const context =
    localSnapshotContext ??
    (await buildLocalGameSnapshotContext(objectId, shop));
  const upload = await uploadLocalGameSnapshot(
    objectId,
    shop,
    onProgress,
    context
  );
  if (!upload.snapshotId) return null;

  const committed = validateCommitResponse(
    await HydraApi.post<unknown>("/profile/cloud-saves/commit-snapshot", {
      snapshotId: upload.snapshotId,
    })
  );

  await saveCloudSaveSyncAnchor(shop, objectId, context.environmentId, {
    baseSnapshotId: committed.snapshotId,
    baseAggregateHash: committed.aggregateHash,
    updatedAt: new Date().toISOString(),
  });

  return {
    id: committed.snapshotId,
    status: committed.status,
    fileCount: committed.fileCount,
    totalSizeBytes: committed.totalSizeBytes,
    aggregateHash: committed.aggregateHash,
  };
};
