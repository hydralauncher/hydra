import { HydraApi } from "@main/services/hydra-api";
import { logger } from "@main/services/logger";
import { SystemPath } from "@main/services/system-path";
import type {
  RemoteSnapshotSummary,
  ReplaceRestoreTarget,
  ResolvedRestoreTarget,
  RestoreRemoteSnapshotResult,
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
  snapshotId: string
): Promise<RestoreRemoteSnapshotResult> => {
  const manifest = await getRemoteSnapshotRestoreManifest(snapshotId);
  const [targets, snapshot] = await Promise.all([
    resolveRestoreManifestTargets(manifest),
    getSnapshotSummary(
      snapshotId,
      manifest.snapshot.shop,
      manifest.snapshot.objectId
    ),
  ]);
  const skipKeys = new Set<string>();
  const restoreTargets: ResolvedRestoreTarget[] = [];

  for (const target of targets) {
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
  }

  const shouldCleanup = restoreTargets.length > 0;
  try {
    const downloadedFiles = await downloadRemoteSnapshotToTemp(
      snapshotId,
      restoreTargets
    );
    const downloadedByPath = new Map(
      downloadedFiles.map((file) => [
        fileKey(file.rawPath, file.relativePath),
        file,
      ])
    );

    for (const file of downloadedFiles) {
      const integrity = await verifyDownloadedRestoreFile({
        tempPath: file.tempPath,
        expectedHash: file.hash,
      });
      if (!integrity.ok) {
        throw new Error(
          `Restore file integrity check failed for ${file.rawPath}/${file.relativePath}`
        );
      }
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
    const result = await replaceRestoreTargets(replacements);
    if (result.failedFiles.length > 0) {
      return {
        ok: false,
        restoredFiles: result.restoredFiles.length,
        skippedFiles: result.skippedFiles.length,
        failedFiles: result.failedFiles.length,
      };
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
    return {
      ok: true,
      restoredFiles: result.restoredFiles.length,
      skippedFiles: result.skippedFiles.length,
      failedFiles: 0,
    };
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
