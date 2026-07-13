import { HydraApi } from "@main/services/hydra-api";
import { logger } from "@main/services/logger";
import { SystemPath } from "@main/services/system-path";
import type {
  CloudSaveGameId,
  RemoteSnapshotSummary,
  ReplaceRestoreTarget,
  ResolvedRestoreTarget,
  RestoreRemoteSnapshotResult,
  RestoreProgressPayload,
} from "@types";

import { NativeAddon } from "../native-addon";
import { downloadRemoteSnapshotToTemp } from "./download-remote-snapshot-to-temp";
import { replaceRestoreTargets } from "./replace-restore-targets";
import {
  getRemoteSnapshotRestoreManifest,
  resolveRestoreManifestTargets,
} from "./resolve-remote-snapshot-targets";
import { saveCloudSaveSyncAnchor } from "./sync-anchor";
import { verifyDownloadedRestoreFile } from "./verify-downloaded-restore-file";
import { shouldSkipRestoreFile } from "./should-skip-restore-file";

const fileKey = (rawPath: string, relativePath: string) =>
  JSON.stringify([rawPath, relativePath]);

const validateSnapshotList = (value: unknown): RemoteSnapshotSummary[] => {
  if (!Array.isArray(value)) throw new Error("Invalid snapshots response");
  return value.map((snapshot) => {
    if (!snapshot || typeof snapshot !== "object") {
      throw new Error("Invalid snapshot response item");
    }
    const item = snapshot as Record<string, unknown>;
    if (
      typeof item.id !== "string" ||
      (item.status !== "active" && item.status !== "historical") ||
      typeof item.createdAt !== "string" ||
      typeof item.fileCount !== "number" ||
      typeof item.totalSizeBytes !== "number" ||
      typeof item.aggregateHash !== "string"
    ) {
      throw new Error("Invalid snapshot response item");
    }
    return item as unknown as RemoteSnapshotSummary;
  });
};

const getSnapshotSummary = async (
  snapshotId: string,
  shop: string,
  objectId: string
) => {
  const snapshots = validateSnapshotList(
    await HydraApi.get<unknown>("/profile/cloud-saves/snapshots", {
      shop,
      objectId,
    })
  );
  const snapshot = snapshots.find((item) => item.id === snapshotId);
  if (!snapshot) throw new Error("Restore snapshot metadata not found");
  return snapshot;
};

export const restoreRemoteSnapshot = async (
  snapshotId: string,
  gameId: CloudSaveGameId,
  onProgress?: (progress: RestoreProgressPayload) => void
): Promise<RestoreRemoteSnapshotResult> => {
  const emitProgress = (
    stage: RestoreProgressPayload["stage"],
    processedFiles: number,
    totalFiles: number
  ) => onProgress?.({ gameId, stage, processedFiles, totalFiles });

  emitProgress("starting", 0, 0);
  const manifest = await getRemoteSnapshotRestoreManifest(snapshotId);
  if (
    manifest.snapshot.shop !== gameId.shop ||
    manifest.snapshot.objectId !== gameId.objectId
  ) {
    throw new Error("Restore snapshot does not belong to the requested game");
  }

  emitProgress("resolving", 0, manifest.files.length);
  const [targets, snapshot] = await Promise.all([
    resolveRestoreManifestTargets(manifest),
    getSnapshotSummary(
      snapshotId,
      manifest.snapshot.shop,
      manifest.snapshot.objectId
    ),
  ]);
  emitProgress("resolving", targets.length, targets.length);
  const skipKeys = new Set<string>();
  const restoreTargets: ResolvedRestoreTarget[] = [];

  emitProgress("checking", 0, targets.length);
  for (const [index, target] of targets.entries()) {
    if (
      await shouldSkipRestoreFile({
        localPath: target.targetPath,
        expectedHash: target.hash,
      })
    ) {
      skipKeys.add(fileKey(target.rawPath, target.relativePath));
    } else {
      restoreTargets.push(target);
    }
    emitProgress("checking", index + 1, targets.length);
  }

  const shouldCleanup = restoreTargets.length > 0;
  try {
    emitProgress("downloading", 0, restoreTargets.length);
    const downloadedFiles = await downloadRemoteSnapshotToTemp(
      snapshotId,
      restoreTargets,
      (processedFiles, totalFiles) =>
        emitProgress("downloading", processedFiles, totalFiles)
    );
    const downloadedByPath = new Map(
      downloadedFiles.map((file) => [
        fileKey(file.rawPath, file.relativePath),
        file,
      ])
    );

    emitProgress("verifying", 0, downloadedFiles.length);
    for (const [index, file] of downloadedFiles.entries()) {
      const integrity = await verifyDownloadedRestoreFile({
        tempPath: file.tempPath,
        expectedHash: file.hash,
      });
      if (!integrity.ok) {
        throw new Error(
          `Restore file integrity check failed for ${file.rawPath}/${file.relativePath}`
        );
      }
      emitProgress("verifying", index + 1, downloadedFiles.length);
    }

    const replacements: ReplaceRestoreTarget[] = targets.map((target) => {
      const key = fileKey(target.rawPath, target.relativePath);
      if (skipKeys.has(key)) {
        return {
          rawPath: target.rawPath,
          relativePath: target.relativePath,
          targetPath: target.targetPath,
          action: "skip",
        };
      }
      const file = downloadedByPath.get(key);
      if (!file) throw new Error("Missing downloaded restore file");
      return {
        rawPath: target.rawPath,
        relativePath: target.relativePath,
        targetPath: target.targetPath,
        action: "restore",
        tempPath: file.tempPath,
        expectedHash: file.hash,
      };
    });
    emitProgress("applying_restore", 0, replacements.length);
    const result = await replaceRestoreTargets(replacements);
    emitProgress("applying_restore", replacements.length, replacements.length);
    if (result.failedFiles.length > 0) {
      const restoreResult = {
        ok: false,
        restoredFiles: result.restoredFiles.length,
        skippedFiles: result.skippedFiles.length,
        failedFiles: result.failedFiles.length,
      };
      emitProgress("completed", replacements.length, replacements.length);
      return restoreResult;
    }

    await saveCloudSaveSyncAnchor(
      manifest.snapshot.shop,
      manifest.snapshot.objectId,
      {
        baseSnapshotId: snapshot.id,
        baseAggregateHash: snapshot.aggregateHash,
        updatedAt: new Date().toISOString(),
      }
    );
    const restoreResult = {
      ok: true,
      restoredFiles: result.restoredFiles.length,
      skippedFiles: result.skippedFiles.length,
      failedFiles: 0,
    };
    emitProgress("completed", targets.length, targets.length);
    return restoreResult;
  } finally {
    if (shouldCleanup) {
      await NativeAddon.cleanupRestoreTempSnapshot(
        snapshotId,
        SystemPath.getPath("temp")
      ).catch((error) =>
        logger.warn("Failed to clean cloud save restore temp files", error)
      );
    }
  }
};
