import os from "node:os";

import { HydraApi } from "@main/services/hydra-api";
import type {
  CloudSaveUploadProgress,
  GameShop,
  LocalGameSnapshotPipelineResult,
  UploadLocalGameSnapshotResult,
} from "@types";

import { NativeAddon } from "../native-addon";
import { buildLocalGameSnapshotContext } from "./build-local-game-snapshot";
import {
  groupUploadsByHash,
  validatePrepareResponse,
} from "./upload-local-game-snapshot-helpers";

type ProgressCallback = (progress: CloudSaveUploadProgress) => void;

const fileKey = (rawPath: string, relativePath: string) =>
  JSON.stringify([rawPath, relativePath]);

export const uploadLocalGameSnapshot = async (
  objectId: string,
  shop: GameShop,
  onProgress?: ProgressCallback,
  localSnapshotContext?: LocalGameSnapshotPipelineResult
): Promise<UploadLocalGameSnapshotResult> => {
  const context =
    localSnapshotContext ??
    (await buildLocalGameSnapshotContext(objectId, shop));
  if (context.files.length === 0) {
    return { snapshotId: null, uploadedFiles: 0, skippedFiles: 0 };
  }
  if (context.files.some((file) => file.sizeBytes <= 0)) {
    throw new Error("Cloud save snapshot contains an empty file");
  }

  const response = validatePrepareResponse(
    await HydraApi.post<unknown>("/profile/cloud-saves/prepare-snapshot", {
      shop,
      objectId,
      platform: process.platform,
      hostname: os.hostname(),
      snapshotHash: context.aggregateHash,
      files: context.files,
    })
  );
  if (response.snapshotHash !== context.aggregateHash) {
    throw new Error("Prepare snapshot hash does not match local snapshot");
  }

  const sourceByPath = new Map(
    context.sourceFiles.map((file) => [
      fileKey(file.rawPath, file.relativePath),
      file,
    ])
  );
  const responseWithSources = response.files.map((file) => {
    const source = sourceByPath.get(fileKey(file.rawPath, file.relativePath));
    if (!source) {
      throw new Error(
        `Missing local source for ${file.rawPath}/${file.relativePath}`
      );
    }
    return { file, source };
  });
  const totalBytes = responseWithSources.reduce(
    (total, item) => total + item.source.sizeBytes,
    0
  );
  const skipped = responseWithSources.filter(
    (item) => item.file.status === "skip"
  );
  let completedFiles = skipped.length;
  let completedBytes = skipped.reduce(
    (total, item) => total + item.source.sizeBytes,
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

  const uploadsByHash = groupUploadsByHash(responseWithSources);

  for (const uploads of uploadsByHash.values()) {
    const [{ file, source }] = uploads;
    emitProgress(source.relativePath);
    await NativeAddon.uploadLocalSaveBlob(source.absolutePath, file.uploadUrl);
    completedFiles += uploads.length;
    completedBytes += uploads.reduce(
      (total, upload) => total + upload.source.sizeBytes,
      0
    );
    emitProgress(null);
  }

  return {
    snapshotId: response.snapshotId,
    uploadedFiles: responseWithSources.length - skipped.length,
    skippedFiles: skipped.length,
  };
};
