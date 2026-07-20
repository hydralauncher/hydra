import { logger } from "@main/services/logger";
import { SystemPath } from "@main/services/system-path";
import type {
  CloudSaveGameId,
  GameShop,
  ReplaceRestoreTarget,
  RemoteSnapshotSummary,
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
import { listRemoteGameSnapshots } from "./list-remote-game-snapshots";
import {
  mapWithConcurrency,
  MAX_CONCURRENT_RESTORE_OPERATIONS,
} from "./map-with-concurrency";

const fileKey = (rawPath: string, relativePath: string) =>
  JSON.stringify([rawPath, relativePath]);

const targetKey = (targetPath: string) => targetPath.replaceAll("\\", "/");

const getSnapshotSummary = async (
  snapshotId: string,
  shop: GameShop,
  objectId: string
) => {
  const snapshots = await listRemoteGameSnapshots(objectId, shop);
  const snapshot = snapshots.find((item) => item.id === snapshotId);
  if (!snapshot) throw new Error("Restore snapshot metadata not found");
  return snapshot;
};

export const restoreRemoteSnapshot = async (
  snapshotId: string,
  gameId: CloudSaveGameId,
  onProgress?: (progress: RestoreProgressPayload) => void,
  knownSnapshot?: RemoteSnapshotSummary
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
    knownSnapshot ??
      getSnapshotSummary(
        snapshotId,
        manifest.snapshot.shop,
        manifest.snapshot.objectId
      ),
  ]);
  emitProgress("resolving", targets.length, targets.length);
  const skipTargets = new Set<string>();
  const restoreTargets: ResolvedRestoreTarget[] = [];

  emitProgress("checking", 0, targets.length);
  let checkedFiles = 0;
  const skipResults = await mapWithConcurrency(
    targets,
    MAX_CONCURRENT_RESTORE_OPERATIONS,
    (target) =>
      shouldSkipRestoreFile({
        localPath: target.targetPath,
        expectedHash: target.hash,
      }),
    () => {
      checkedFiles += 1;
      emitProgress("checking", checkedFiles, targets.length);
    }
  );
  for (const [index, target] of targets.entries()) {
    if (skipResults[index]) {
      skipTargets.add(targetKey(target.targetPath));
    } else {
      restoreTargets.push(target);
    }
  }

  const shouldCleanup = restoreTargets.length > 0;
  try {
    const requestedLogicalFiles = Array.from(
      new Map(
        restoreTargets.map((target) => [
          fileKey(target.rawPath, target.relativePath),
          {
            rawPath: target.rawPath,
            relativePath: target.relativePath,
            hash: target.hash,
            sizeBytes: target.sizeBytes,
          },
        ])
      ).values()
    );
    emitProgress("downloading", 0, requestedLogicalFiles.length);
    const downloadedFiles = await downloadRemoteSnapshotToTemp(
      snapshotId,
      requestedLogicalFiles,
      (processedFiles, totalFiles) =>
        emitProgress("downloading", processedFiles, totalFiles)
    );
    const downloadedByPath = new Map(
      downloadedFiles.map((file) => [
        fileKey(file.rawPath, file.relativePath),
        file,
      ])
    );

    const downloadedFilesByHash = new Map<string, typeof downloadedFiles>();
    for (const file of downloadedFiles) {
      const existing = downloadedFilesByHash.get(file.hash) ?? [];
      if (
        existing.some(
          (item) =>
            item.sizeBytes !== file.sizeBytes || item.tempPath !== file.tempPath
        )
      ) {
        throw new Error("Downloaded restore blob is inconsistent");
      }
      downloadedFilesByHash.set(file.hash, [...existing, file]);
    }
    const verificationGroups = Array.from(downloadedFilesByHash.values());
    let verifiedFiles = 0;
    emitProgress("verifying", 0, downloadedFiles.length);
    await mapWithConcurrency(
      verificationGroups,
      MAX_CONCURRENT_RESTORE_OPERATIONS,
      async (group) => {
        const [file] = group;
        const integrity = await verifyDownloadedRestoreFile({
          tempPath: file.tempPath,
          expectedHash: file.hash,
        });
        if (!integrity.ok) {
          throw new Error("Restore file integrity check failed");
        }
      },
      (_result, group) => {
        verifiedFiles += group.length;
        emitProgress("verifying", verifiedFiles, downloadedFiles.length);
      }
    );

    const replacements: ReplaceRestoreTarget[] = targets.map((target) => {
      const key = fileKey(target.rawPath, target.relativePath);
      if (skipTargets.has(targetKey(target.targetPath))) {
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
