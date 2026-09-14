import os from "node:os";

import { HydraApi } from "@main/services/hydra-api";
import type {
  CloudSaveUploadProgress,
  GameShop,
  LocalGameSnapshotContext,
  SnapshotFile,
  SnapshotVariant,
  UploadLocalGameSnapshotResult,
} from "@types";

import { NativeAddon } from "../native-addon";
import { buildLocalGameSnapshotContext } from "./build-local-game-snapshot";
import { cloudSaveFileKey } from "./cloud-save-contract";
import { buildPrepareSnapshotPayload } from "./prepare-snapshot-payload";
import {
  groupUploadsByHash,
  validatePrepareResponse,
} from "./upload-local-game-snapshot-helpers";
import { assertCloudSaveUploadWithinLimits } from "./upload-limits";

type ProgressCallback = (progress: CloudSaveUploadProgress) => void;

const MAX_CONCURRENT_UPLOADS = 8;
const blobKey = (file: Pick<SnapshotFile, "hash" | "sizeBytes">) =>
  JSON.stringify([file.hash, file.sizeBytes]);

export interface PrepareLocalSnapshotOptions {
  baseVersion: number;
  customPathRawPaths?: string[];
  variants?: SnapshotVariant[];
  files?: SnapshotFile[];
  aggregateHash?: string;
}

const resolvePrepareLocalSnapshotOptions = (
  options?: PrepareLocalSnapshotOptions
) => {
  if (options !== undefined) return options;
  return { baseVersion: 0 };
};

export const uploadLocalGameSnapshot = async (
  objectId: string,
  shop: GameShop,
  onProgress?: ProgressCallback,
  localSnapshotContext?: LocalGameSnapshotContext,
  options?: PrepareLocalSnapshotOptions
): Promise<UploadLocalGameSnapshotResult> => {
  const resolvedOptions = resolvePrepareLocalSnapshotOptions(options);
  const context =
    localSnapshotContext ??
    (await buildLocalGameSnapshotContext(objectId, shop));
  const proposalVariants = resolvedOptions.variants ?? context.variants;
  const proposalFiles = resolvedOptions.files ?? context.files;
  const proposalCustomPathRawPaths =
    resolvedOptions.customPathRawPaths ?? context.customPathRawPaths;
  const aggregateHash = resolvedOptions.aggregateHash ?? context.aggregateHash;

  assertCloudSaveUploadWithinLimits(proposalFiles);

  const response = validatePrepareResponse(
    await HydraApi.post<unknown>(
      "/profile/cloud-saves/prepare-snapshot",
      buildPrepareSnapshotPayload({
        shop,
        objectId,
        platform: context.pathContext.platform,
        hostname: os.hostname() || undefined,
        snapshotHash: aggregateHash,
        baseVersion: resolvedOptions.baseVersion,
        customPathRawPaths: proposalCustomPathRawPaths,
        variants: proposalVariants,
        files: proposalFiles,
      }),
      { needsAuth: true, needsSubscription: true }
    )
  );
  if (response.snapshotHash !== aggregateHash) {
    throw new Error("Prepare snapshot hash does not match the proposal");
  }

  const sourceByIdentity = new Map(
    context.sourceFiles.map((file) => [cloudSaveFileKey(file), file])
  );
  const sourceByBlob = new Map(
    context.sourceFiles.map((file) => [blobKey(file), file])
  );
  const proposalByIdentity = new Map(
    proposalFiles.map((file) => [cloudSaveFileKey(file), file])
  );
  if (
    proposalByIdentity.size !== proposalFiles.length ||
    response.files.length !== proposalByIdentity.size
  ) {
    throw new Error("Prepare snapshot response does not cover proposal files");
  }

  const responseItems = response.files.map((file) => {
    const key = cloudSaveFileKey(file);
    const proposal = proposalByIdentity.get(key);
    if (!proposal) {
      throw new Error(`Unknown prepare response file ${key}`);
    }
    let source = sourceByIdentity.get(key);
    if (file.status === "upload") {
      if (
        file.requiredHeaders["Content-Length"] !== String(proposal.sizeBytes) ||
        file.requiredHeaders["x-amz-checksum-sha256"] !==
          Buffer.from(proposal.hash, "hex").toString("base64")
      ) {
        throw new Error("Prepare upload headers do not match the proposal");
      }
      source ??= sourceByBlob.get(blobKey(proposal));
      if (
        source?.hash !== proposal.hash ||
        source?.sizeBytes !== proposal.sizeBytes
      ) {
        throw new Error(`Missing local upload source for ${key}`);
      }
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

  const uploadItems = responseItems.flatMap(({ file, source }) =>
    file.status === "upload" && source ? [{ file, source }] : []
  );
  const uploadJobs = [...groupUploadsByHash(uploadItems).values()];
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
          file.uploadUrl,
          file.requiredHeaders["Content-Length"],
          file.requiredHeaders["x-amz-checksum-sha256"]
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
