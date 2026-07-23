import { HydraApi } from "@main/services/hydra-api";
import type {
  CloudSaveUploadProgress,
  CommitSnapshotRequest,
  CommitSnapshotResponse,
  GameShop,
  LocalGameSnapshotContext,
  RemoteGameSnapshot,
  SnapshotFile,
} from "@types";

import { NativeAddon } from "../native-addon";
import { buildLocalGameSnapshotContext } from "./build-local-game-snapshot";
import {
  CLOUD_SAVE_HASH_PATTERN,
  cloudSaveFileKey,
  isNonEmptyString,
} from "./cloud-save-contract";
import { saveCloudSaveSyncAnchor } from "./sync-anchor";
import {
  isCloudSaveCommitTransportFailure,
  shouldReprepareCloudSaveSnapshot,
} from "./snapshot-retry-policy";
import {
  uploadLocalGameSnapshot,
  type PrepareLocalSnapshotOptions,
} from "./upload-local-game-snapshot";

type ProgressCallback = (progress: CloudSaveUploadProgress) => void;

export interface CreateRemoteSnapshotOptions
  extends PrepareLocalSnapshotOptions {
  expectedSnapshotId?: string | null;
  unresolvedRemoteEntryIds?: string[];
}

const validateCommitResponse = (value: unknown): CommitSnapshotResponse => {
  if (!value || typeof value !== "object") {
    throw new Error("Invalid commit snapshot response");
  }
  const response = value as Record<string, unknown>;
  if (
    Object.keys(response).some(
      (key) =>
        ![
          "snapshotId",
          "version",
          "fileCount",
          "totalSizeBytes",
          "aggregateHash",
        ].includes(key)
    ) ||
    !isNonEmptyString(response.snapshotId) ||
    typeof response.version !== "number" ||
    !Number.isSafeInteger(response.version) ||
    response.version < 1 ||
    typeof response.fileCount !== "number" ||
    !Number.isSafeInteger(response.fileCount) ||
    response.fileCount < 1 ||
    typeof response.totalSizeBytes !== "number" ||
    !Number.isSafeInteger(response.totalSizeBytes) ||
    response.totalSizeBytes < 0 ||
    !isNonEmptyString(response.aggregateHash) ||
    !CLOUD_SAVE_HASH_PATTERN.test(response.aggregateHash)
  ) {
    throw new Error("Invalid commit snapshot response");
  }
  return value as CommitSnapshotResponse;
};

const commitPendingSnapshot = async (pendingSnapshotId: string) => {
  let response: unknown;
  const request: CommitSnapshotRequest = { pendingSnapshotId };
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      response = await HydraApi.post<unknown>(
        "/profile/cloud-saves/commit-snapshot",
        request,
        { needsAuth: true, needsSubscription: true }
      );
      break;
    } catch (error) {
      if (attempt === 0 && isCloudSaveCommitTransportFailure(error)) continue;
      throw error;
    }
  }
  return validateCommitResponse(response);
};

export const createRemoteSnapshotFromLocalState = async (
  objectId: string,
  shop: GameShop,
  onProgress?: ProgressCallback,
  localSnapshotContext?: LocalGameSnapshotContext,
  options: CreateRemoteSnapshotOptions = { baseVersion: 0 }
): Promise<RemoteGameSnapshot | null> => {
  const context =
    localSnapshotContext ??
    (await buildLocalGameSnapshotContext(objectId, shop));
  const variants = options.variants ?? context.variants;
  const files: SnapshotFile[] = options.files ?? context.files;
  if (files.length === 0) return null;
  const expectedAggregateHash =
    options.aggregateHash ??
    NativeAddon.buildSnapshotAggregateHash({ variants, files });

  let committed: CommitSnapshotResponse | null = null;
  for (let prepareAttempt = 0; prepareAttempt < 2; prepareAttempt += 1) {
    try {
      const upload = await uploadLocalGameSnapshot(
        objectId,
        shop,
        onProgress,
        context,
        { ...options, variants, files, aggregateHash: expectedAggregateHash }
      );
      if (!upload.pendingSnapshotId) return null;
      committed = await commitPendingSnapshot(upload.pendingSnapshotId);
      break;
    } catch (error) {
      if (prepareAttempt === 0 && shouldReprepareCloudSaveSnapshot(error))
        continue;
      throw error;
    }
  }
  if (!committed) throw new Error("Cloud Save commit did not complete");

  const expectedTotalSize = files.reduce(
    (total, file) => total + file.sizeBytes,
    0
  );
  if (
    committed.version !== options.baseVersion + 1 ||
    (options.expectedSnapshotId &&
      committed.snapshotId !== options.expectedSnapshotId) ||
    committed.fileCount !== files.length ||
    committed.totalSizeBytes !== expectedTotalSize ||
    committed.aggregateHash !== expectedAggregateHash
  ) {
    throw new Error("Committed Cloud Save snapshot is inconsistent");
  }

  await saveCloudSaveSyncAnchor(shop, objectId, context.environmentId, {
    schemaVersion: 4,
    environmentId: context.environmentId,
    baseSnapshotId: committed.snapshotId,
    baseVersion: committed.version,
    baseAggregateHash: committed.aggregateHash,
    entries: files.map((file) => ({
      variantId: file.variantId,
      rawPath: file.rawPath,
      relativePath: file.relativePath,
      hash: file.hash,
      sizeBytes: file.sizeBytes,
    })),
    unresolvedRemoteEntryIds: (options.unresolvedRemoteEntryIds ?? []).filter(
      (entryId) => files.some((file) => cloudSaveFileKey(file) === entryId)
    ),
    updatedAt: new Date().toISOString(),
  });

  return {
    id: committed.snapshotId,
    version: committed.version,
    fileCount: committed.fileCount,
    totalSizeBytes: committed.totalSizeBytes,
    aggregateHash: committed.aggregateHash,
  };
};
