import { HydraApi } from "@main/services/hydra-api";
import type {
  CloudSaveUploadProgress,
  CommitSnapshotResponse,
  GameShop,
  LocalGameSnapshotContext,
  RemoteGameSnapshot,
  UserVariantSnapshotFile,
} from "@types";

import { NativeAddon } from "../native-addon";
import { validateUniqueLogicalFiles } from "./cloud-save-contract";
import { saveCloudSaveSyncAnchor } from "./sync-anchor";
import {
  uploadLocalGameSnapshot,
  type PrepareLocalSnapshotOptions,
} from "./upload-local-game-snapshot";
import { buildLocalGameSnapshotContext } from "./build-local-game-snapshot";

type ProgressCallback = (progress: CloudSaveUploadProgress) => void;

export interface CreateRemoteSnapshotOptions
  extends PrepareLocalSnapshotOptions {
  unresolvedRemoteEntryIds?: string[];
}

const validateCommitResponse = (value: unknown): CommitSnapshotResponse => {
  if (!value || typeof value !== "object") {
    throw new Error("Invalid commit snapshot response");
  }

  const response = value as Record<string, unknown>;
  if (
    typeof response.snapshotId !== "string" ||
    response.snapshotId.length === 0 ||
    response.status !== "active" ||
    typeof response.revision !== "number" ||
    !Number.isSafeInteger(response.revision) ||
    response.revision < 1 ||
    typeof response.schemaVersion !== "number" ||
    !Number.isSafeInteger(response.schemaVersion) ||
    response.schemaVersion < 1 ||
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
  const files = validateUniqueLogicalFiles(response.files);
  if (
    files.length !== response.fileCount ||
    files.reduce((total, file) => total + file.sizeBytes, 0) !==
      response.totalSizeBytes
  ) {
    throw new Error("Commit snapshot manifest is inconsistent");
  }

  return { ...(response as unknown as CommitSnapshotResponse), files };
};

export const createRemoteSnapshotFromLocalState = async (
  objectId: string,
  shop: GameShop,
  onProgress?: ProgressCallback,
  localSnapshotContext?: LocalGameSnapshotContext,
  options: CreateRemoteSnapshotOptions = {
    expectedHeadRevision: 0,
    expectedHeadHash: null,
  }
): Promise<RemoteGameSnapshot | null> => {
  const context =
    localSnapshotContext ??
    (await buildLocalGameSnapshotContext(objectId, shop));
  const files: UserVariantSnapshotFile[] = options.files ?? context.files;
  const upload = await uploadLocalGameSnapshot(
    objectId,
    shop,
    onProgress,
    context,
    { ...options, files }
  );
  if (!upload.pendingSnapshotId) return null;

  const committed = validateCommitResponse(
    await HydraApi.post<unknown>("/profile/cloud-saves/commit-snapshot", {
      pendingSnapshotId: upload.pendingSnapshotId,
    })
  );
  const expectedAggregateHash = options.aggregateHash ?? context.aggregateHash;
  const committedAggregateHash = NativeAddon.buildSnapshotAggregateHash({
    schemaVersion: committed.schemaVersion,
    saveNamespaceKey: context.saveNamespaceKey,
    files: committed.files,
  });
  if (
    committed.schemaVersion !== context.schemaVersion ||
    committed.revision !== options.expectedHeadRevision + 1 ||
    committed.aggregateHash !== expectedAggregateHash ||
    committedAggregateHash !== committed.aggregateHash
  ) {
    throw new Error("Committed Cloud Save snapshot is inconsistent");
  }

  await saveCloudSaveSyncAnchor(shop, objectId, context.environmentId, {
    schemaVersion: 3,
    environmentId: context.environmentId,
    baseSnapshotId: committed.snapshotId,
    baseHeadRevision: committed.revision,
    baseAggregateHash: committed.aggregateHash,
    entries: committed.files.map((file) => ({
      logicalFileId: file.logicalFileId,
      contentHash: file.contentHash,
      sizeBytes: file.sizeBytes,
    })),
    unresolvedRemoteEntryIds: options.unresolvedRemoteEntryIds ?? [],
    updatedAt: new Date().toISOString(),
  });

  return {
    id: committed.snapshotId,
    status: committed.status,
    revision: committed.revision,
    schemaVersion: committed.schemaVersion,
    fileCount: committed.fileCount,
    totalSizeBytes: committed.totalSizeBytes,
    aggregateHash: committed.aggregateHash,
  };
};
