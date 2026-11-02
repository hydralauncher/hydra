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

import { buildCloudSaveAggregateHash } from "./snapshot-aggregate-hash";
import { assertCloudSaveV2Eligible } from "./assert-cloud-save-executable";
import { buildLocalGameSnapshotContext } from "./build-local-game-snapshot";
import { getCloudSaveCustomPathBindings } from "./custom-path-store";
import { cloudSaveCustomPathContextFromPathContext } from "./custom-path";
import { getEmulatorSaveProvider } from "./emulator-save-provider";
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
  updateAnchor?: boolean;
  assertEnvironmentCurrent?: () => Promise<void>;
}

const resolveCreateRemoteSnapshotOptions = (
  options?: CreateRemoteSnapshotOptions
) => {
  if (options !== undefined) return options;
  return { baseVersion: 0 };
};

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
    response.fileCount < 0 ||
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
  options?: CreateRemoteSnapshotOptions
): Promise<RemoteGameSnapshot | null> => {
  const game = await assertCloudSaveV2Eligible(objectId, shop);
  const resolvedOptions = resolveCreateRemoteSnapshotOptions(options);
  const context =
    localSnapshotContext ??
    (await buildLocalGameSnapshotContext(objectId, shop));
  const variants = resolvedOptions.variants ?? context.variants;
  const files: SnapshotFile[] = resolvedOptions.files ?? context.files;
  if (getEmulatorSaveProvider(game) === "rpcs3") {
    const { assertRpcs3DiscIdentity, assertRpcs3SnapshotIdentity } =
      await import("./rpcs3-game-identity.js");
    const bindings = await getCloudSaveCustomPathBindings(
      shop,
      objectId,
      cloudSaveCustomPathContextFromPathContext(context.pathContext)
    );
    assertRpcs3SnapshotIdentity(
      files,
      await assertRpcs3DiscIdentity(game),
      bindings.ready
    );
  }
  const customPathRawPaths =
    resolvedOptions.customPathRawPaths ?? context.customPathRawPaths;
  const expectedAggregateHash =
    resolvedOptions.aggregateHash ??
    buildCloudSaveAggregateHash({ variants, files });

  let committed: CommitSnapshotResponse | null = null;
  for (let prepareAttempt = 0; prepareAttempt < 2; prepareAttempt += 1) {
    try {
      await resolvedOptions.assertEnvironmentCurrent?.();
      const upload = await uploadLocalGameSnapshot(
        objectId,
        shop,
        onProgress,
        context,
        {
          ...resolvedOptions,
          ...(getEmulatorSaveProvider(game) === "retroarch"
            ? { retroArchFormatVersion: 2 as const }
            : {}),
          variants,
          files,
          customPathRawPaths,
          aggregateHash: expectedAggregateHash,
        }
      );
      if (!upload.pendingSnapshotId) return null;
      await resolvedOptions.assertEnvironmentCurrent?.();
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
    committed.version !== resolvedOptions.baseVersion + 1 ||
    (resolvedOptions.expectedSnapshotId &&
      committed.snapshotId !== resolvedOptions.expectedSnapshotId) ||
    committed.fileCount !== files.length ||
    committed.totalSizeBytes !== expectedTotalSize ||
    committed.aggregateHash !== expectedAggregateHash
  ) {
    throw new Error("Committed Cloud Save snapshot is inconsistent");
  }

  if (resolvedOptions.updateAnchor !== false) {
    await resolvedOptions.assertEnvironmentCurrent?.();
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
        ...(file.stateMetadata ? { stateMetadata: file.stateMetadata } : {}),
      })),
      unresolvedRemoteEntryIds: (
        resolvedOptions.unresolvedRemoteEntryIds ?? []
      ).filter((entryId) =>
        files.some((file) => cloudSaveFileKey(file) === entryId)
      ),
      updatedAt: new Date().toISOString(),
    });
  }

  return {
    id: committed.snapshotId,
    version: committed.version,
    fileCount: committed.fileCount,
    totalSizeBytes: committed.totalSizeBytes,
    aggregateHash: committed.aggregateHash,
  };
};
