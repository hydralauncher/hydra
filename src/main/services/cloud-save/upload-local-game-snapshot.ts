import { HydraApi } from "@main/services/hydra-api";
import type {
  CloudSaveUploadProgress,
  GameShop,
  LocalGameSnapshotContext,
  UploadLocalGameSnapshotResult,
  UserVariantSnapshotFile,
} from "@types";

import { NativeAddon } from "../native-addon";
import { buildLocalGameSnapshotContext } from "./build-local-game-snapshot";
import {
  groupUploadsByHash,
  validatePrepareResponse,
} from "./upload-local-game-snapshot-helpers";

type ProgressCallback = (progress: CloudSaveUploadProgress) => void;

const MAX_CONCURRENT_UPLOADS = 8;

const fileKey = (logicalFileId: string) => logicalFileId;

export interface PrepareLocalSnapshotOptions {
  expectedHeadRevision: number;
  expectedHeadHash: string | null;
  files?: UserVariantSnapshotFile[];
  aggregateHash?: string;
}

export const uploadLocalGameSnapshot = async (
  objectId: string,
  shop: GameShop,
  onProgress?: ProgressCallback,
  localSnapshotContext?: LocalGameSnapshotContext,
  options: PrepareLocalSnapshotOptions = {
    expectedHeadRevision: 0,
    expectedHeadHash: null,
  }
): Promise<UploadLocalGameSnapshotResult> => {
  const context =
    localSnapshotContext ??
    (await buildLocalGameSnapshotContext(objectId, shop));
  const proposalFiles = options.files ?? context.files;
  const aggregateHash = options.aggregateHash ?? context.aggregateHash;
  const response = validatePrepareResponse(
    await HydraApi.post<unknown>("/profile/cloud-saves/prepare-snapshot", {
      shop,
      objectId,
      saveNamespaceKey: context.saveNamespaceKey,
      schemaVersion: context.schemaVersion,
      ruleSourceRevision: context.ruleSourceRevision,
      discoveryEngineVersion: context.discoveryEngineVersion,
      expectedHeadRevision: options.expectedHeadRevision,
      expectedHeadHash: options.expectedHeadHash,
      snapshotHash: aggregateHash,
      files: proposalFiles,
    })
  );
  if (
    response.snapshotHash !== aggregateHash ||
    response.expectedHeadRevision !== options.expectedHeadRevision
  ) {
    throw new Error("Prepare snapshot hash does not match local snapshot");
  }

  const sourceById = new Map(
    context.sourceFiles.map((file) => [fileKey(file.logicalFileId), file])
  );
  const proposalById = new Map(
    proposalFiles.map((file) => [file.logicalFileId, file])
  );
  if (
    proposalById.size !== proposalFiles.length ||
    response.files.length !== proposalById.size
  ) {
    throw new Error("Prepare snapshot response does not cover proposal files");
  }
  const responseItems = response.files.map((file) => {
    const proposal = proposalById.get(file.logicalFileId);
    if (!proposal) {
      throw new Error(`Unknown prepare response file ${file.logicalFileId}`);
    }
    const source = sourceById.get(fileKey(file.logicalFileId));
    if (file.status === "upload" && !source) {
      throw new Error(`Missing local source for ${file.logicalFileId}`);
    }
    return { file, proposal, source };
  });
  const totalBytes = responseItems.reduce(
    (total, item) => total + item.proposal.sizeBytes,
    0
  );
  const skipped = responseItems.filter((item) => item.file.status === "skip");
  let completedFiles = skipped.length;
  let completedBytes = skipped.reduce(
    (total, item) => total + item.proposal.sizeBytes,
    0
  );
  const emitProgress = (currentFile: string | null) =>
    onProgress?.({
      completedFiles,
      totalFiles: response.files.length,
      completedBytes,
      totalBytes,
      currentFile,
    });
  emitProgress(null);

  const uploadItems = responseItems
    .map(({ file, source }) => {
      if (!source) return null;
      return { file, source };
    })
    .filter((item): item is NonNullable<typeof item> => item !== null);
  const uploadsByHash = groupUploadsByHash(uploadItems);
  const uploadJobs = Array.from(uploadsByHash.values());
  const activeFiles = new Map<number, string>();
  let nextUploadIndex = 0;
  let hasFailed = false;
  const emitCurrentProgress = () =>
    emitProgress(activeFiles.values().next().value ?? null);

  const runWorker = async () => {
    while (!hasFailed) {
      const uploadIndex = nextUploadIndex;
      if (uploadIndex >= uploadJobs.length) return;
      nextUploadIndex += 1;

      const uploads = uploadJobs[uploadIndex];
      const [{ file, source }] = uploads;
      activeFiles.set(uploadIndex, source.relativePath);
      emitCurrentProgress();

      try {
        await NativeAddon.uploadLocalSaveBlob(
          source.absolutePath,
          file.uploadUrl
        );
      } catch (error) {
        hasFailed = true;
        activeFiles.delete(uploadIndex);
        throw error;
      }

      activeFiles.delete(uploadIndex);
      if (hasFailed) return;

      completedFiles += uploads.length;
      completedBytes += uploads.reduce(
        (total, upload) => total + upload.source.sizeBytes,
        0
      );
      emitCurrentProgress();
    }
  };

  await Promise.all(
    Array.from(
      { length: Math.min(MAX_CONCURRENT_UPLOADS, uploadJobs.length) },
      runWorker
    )
  );

  return {
    pendingSnapshotId: response.pendingSnapshotId,
    uploadedFiles: responseItems.length - skipped.length,
    skippedFiles: skipped.length,
  };
};
