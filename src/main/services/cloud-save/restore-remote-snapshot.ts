import { logger } from "@main/services/logger";
import { SystemPath } from "@main/services/system-path";
import type {
  CloudSaveGameId,
  CloudSavePathContext,
  ReplaceRestoreTarget,
  RemoteGameSnapshot,
  RemoteSnapshotSummary,
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
import {
  mapWithConcurrency,
  MAX_CONCURRENT_RESTORE_OPERATIONS,
} from "./map-with-concurrency";
import { getCloudSaveGameContext } from "./cloud-save-game-context";

interface RestoreCloudSaveContext {
  environmentId: string;
  pathContext: CloudSavePathContext;
}

export const restoreRemoteSnapshot = async (
  snapshotId: string,
  gameId: CloudSaveGameId,
  onProgress?: (progress: RestoreProgressPayload) => void,
  _knownSnapshot?: RemoteSnapshotSummary | RemoteGameSnapshot,
  suppliedContext?: RestoreCloudSaveContext,
  requestedLogicalFileIds?: string[],
  updateAnchor = true,
  carriedUnresolvedEntryIds: string[] = []
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

  const requestedIds = requestedLogicalFileIds
    ? new Set(requestedLogicalFileIds)
    : null;
  const selectedFiles = requestedIds
    ? manifest.files.filter((file) => requestedIds.has(file.logicalFileId))
    : manifest.files;
  const selectedIds = new Set(selectedFiles.map((file) => file.logicalFileId));
  if (requestedIds && selectedFiles.length !== requestedIds.size) {
    throw new Error("Requested restore logical file is missing from manifest");
  }
  const selectedManifest = { ...manifest, files: selectedFiles };
  emitProgress("resolving", 0, selectedFiles.length);
  const cloudSaveContext =
    suppliedContext ??
    (await getCloudSaveGameContext(gameId.objectId, gameId.shop));
  const plan = await resolveRestoreManifestTargets(
    selectedManifest,
    cloudSaveContext.pathContext
  );
  emitProgress("resolving", plan.actions.length, selectedFiles.length);

  const skippedTargets = plan.actions.filter(
    (target) => target.action === "skip-identical"
  );
  const restoreTargets = plan.actions.filter(
    (target) => target.action !== "skip-identical"
  );
  const shouldCleanup = restoreTargets.length > 0;

  try {
    emitProgress("downloading", 0, restoreTargets.length);
    const downloadedFiles = await downloadRemoteSnapshotToTemp(
      snapshotId,
      restoreTargets,
      (processedFiles, totalFiles) =>
        emitProgress("downloading", processedFiles, totalFiles)
    );
    const downloadedById = new Map(
      downloadedFiles.map((file) => [file.logicalFileId, file])
    );
    const downloadedFilesByContent = new Map<string, typeof downloadedFiles>();
    for (const file of downloadedFiles) {
      const key = JSON.stringify([file.contentHash, file.sizeBytes]);
      const existing = downloadedFilesByContent.get(key) ?? [];
      if (existing.some((item) => item.tempPath !== file.tempPath)) {
        throw new Error("Downloaded restore blob is inconsistent");
      }
      downloadedFilesByContent.set(key, [...existing, file]);
    }

    let verifiedFiles = 0;
    emitProgress("verifying", 0, downloadedFiles.length);
    await mapWithConcurrency(
      Array.from(downloadedFilesByContent.values()),
      MAX_CONCURRENT_RESTORE_OPERATIONS,
      async (group) => {
        const [file] = group;
        const integrity = await verifyDownloadedRestoreFile({
          tempPath: file.tempPath,
          expectedHash: file.contentHash,
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

    const identity = ({
      logicalFileId,
      variantId,
      ruleId,
      relativePath,
      targetPath,
    }: (typeof plan.actions)[number]) => ({
      logicalFileId,
      variantId,
      ruleId,
      relativePath,
      targetPath,
    });
    const replacements: ReplaceRestoreTarget[] = [
      ...skippedTargets.map((target) => ({
        ...identity(target),
        action: "skip" as const,
      })),
      ...restoreTargets.map((target) => {
        const file = downloadedById.get(target.logicalFileId);
        if (!file) throw new Error("Missing downloaded restore file");
        return {
          ...identity(target),
          action: "restore" as const,
          tempPath: file.tempPath,
          expectedHash: file.contentHash,
        };
      }),
    ];
    emitProgress("applying_restore", 0, replacements.length);
    const result = await replaceRestoreTargets(replacements);
    emitProgress("applying_restore", replacements.length, replacements.length);
    const blockedIds = plan.blocked.map((file) => file.logicalFileId);
    const unresolvedRemoteEntryIds = [
      ...new Set([
        ...carriedUnresolvedEntryIds.filter(
          (logicalFileId) => !selectedIds.has(logicalFileId)
        ),
        ...blockedIds,
      ]),
    ].sort();

    if (result.failedFiles.length === 0 && updateAnchor) {
      await saveCloudSaveSyncAnchor(
        manifest.snapshot.shop,
        manifest.snapshot.objectId,
        cloudSaveContext.environmentId,
        {
          schemaVersion: 3,
          environmentId: cloudSaveContext.environmentId,
          baseSnapshotId: manifest.snapshot.id,
          baseHeadRevision: manifest.snapshot.revision,
          baseAggregateHash: manifest.snapshot.aggregateHash,
          entries: manifest.files.map((file) => ({
            logicalFileId: file.logicalFileId,
            contentHash: file.contentHash,
            sizeBytes: file.sizeBytes,
          })),
          unresolvedRemoteEntryIds,
          updatedAt: new Date().toISOString(),
        }
      );
    }

    const partial = unresolvedRemoteEntryIds.length > 0;
    const restoreResult: RestoreRemoteSnapshotResult = {
      ok: result.failedFiles.length === 0,
      partial,
      restoredFiles: result.restoredFiles.length,
      skippedFiles: result.skippedFiles.length,
      failedFiles: result.failedFiles.length,
      blockedFiles: plan.blocked.length,
      unresolvedRemoteEntryIds,
    };
    emitProgress("completed", plan.actions.length, selectedFiles.length);
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
