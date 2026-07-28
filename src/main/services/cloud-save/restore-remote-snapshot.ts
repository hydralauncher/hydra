import { isAxiosError } from "axios";

import { logger } from "@main/services/logger";
import { SystemPath } from "@main/services/system-path";
import type {
  CloudSaveGameId,
  LocalGameSnapshotContext,
  RemoteGameSnapshot,
  RemoteSnapshotSummary,
  RestoreProgressPayload,
  RestoreRemoteSnapshotResult,
} from "@types";

import { NativeAddon } from "../native-addon";
import { assertCloudSaveSubscription } from "./cloud-save-access";
import { cloudSaveFileKey } from "./cloud-save-contract";
import { getCloudSaveGameContext } from "./cloud-save-game-context";
import { downloadRemoteSnapshotToTemp } from "./download-remote-snapshot-to-temp";
import { listRemoteGameSnapshots } from "./list-remote-game-snapshots";
import {
  mapWithConcurrency,
  MAX_CONCURRENT_RESTORE_OPERATIONS,
} from "./map-with-concurrency";
import { replaceRestoreTargets } from "./replace-restore-targets";
import {
  buildRestoreReplacements,
  isRestoreReplacementSuccessful,
} from "./restore-replacements";
import { getRestoreVersionDecision } from "./restore-version-policy";
import {
  getRestorableCloudSaveCustomPaths,
  getRemoteSnapshotRestoreManifest,
  resolveRestoreManifestTargets,
} from "./resolve-remote-snapshot-targets";
import { saveCloudSaveSyncAnchor } from "./sync-anchor";
import { verifyDownloadedRestoreFile } from "./verify-downloaded-restore-file";
import { registerCloudSaveCustomPaths } from "./custom-path-store";
import { CLOUD_SAVE_CUSTOM_PATH_PREFIX } from "./custom-path";
import { isEmulatorCloudSaveRawPath } from "./emulator-cloud-save-codec";
import { buildLocalGameSnapshotContext } from "./build-local-game-snapshot";
import {
  applyEmulatorRestoreFiles,
  resolveEmulatorRestoreTargets,
} from "./emulator-cloud-save-restore";

interface RestoreCloudSaveContext
  extends Pick<
    LocalGameSnapshotContext,
    "environmentId" | "pathContext" | "emulator"
  > {}

const assertSnapshotStillCurrent = async (
  gameId: CloudSaveGameId,
  expected: RemoteSnapshotSummary | RemoteGameSnapshot
) => {
  try {
    const current = (
      await listRemoteGameSnapshots(gameId.objectId, gameId.shop)
    )[0];
    return current?.id === expected.id && current.version === expected.version
      ? current
      : (current ?? null);
  } catch (error) {
    if (isAxiosError(error) && error.response?.status === 404) return null;
    throw error;
  }
};

export const restoreRemoteSnapshot = async (
  snapshotId: string,
  gameId: CloudSaveGameId,
  onProgress?: (progress: RestoreProgressPayload) => void,
  knownSnapshot?: RemoteSnapshotSummary | RemoteGameSnapshot,
  suppliedContext?: RestoreCloudSaveContext,
  requestedEntryIds?: string[],
  updateAnchor = true,
  carriedUnresolvedEntryIds: string[] = [],
  versionChangeAttempt = 0,
  assertEnvironmentCurrent?: () => Promise<void>
): Promise<RestoreRemoteSnapshotResult> => {
  assertCloudSaveSubscription();

  const emitProgress = (
    stage: RestoreProgressPayload["stage"],
    processedFiles: number,
    totalFiles: number
  ) => onProgress?.({ gameId, stage, processedFiles, totalFiles });

  const snapshot =
    knownSnapshot ??
    (await listRemoteGameSnapshots(gameId.objectId, gameId.shop)).find(
      (item) => item.id === snapshotId
    );
  if (!snapshot) throw new Error("cloud_save_restore_snapshot_not_found");
  const tempSnapshotId = `${snapshot.id}-${snapshot.version}`;

  emitProgress("starting", 0, 0);
  const manifest = await getRemoteSnapshotRestoreManifest(snapshot);
  if (
    manifest.snapshot.shop !== gameId.shop ||
    manifest.snapshot.objectId !== gameId.objectId
  ) {
    throw new Error("Restore snapshot does not belong to the requested game");
  }

  const requestedIds = requestedEntryIds ? new Set(requestedEntryIds) : null;
  const selectedFiles = requestedIds
    ? manifest.files.filter((file) => requestedIds.has(cloudSaveFileKey(file)))
    : manifest.files;
  const selectedIds = new Set(selectedFiles.map(cloudSaveFileKey));
  if (requestedIds && selectedFiles.length !== requestedIds.size) {
    throw new Error("Requested restore file is missing from manifest");
  }
  const usedVariantIds = new Set(selectedFiles.map((file) => file.variantId));
  const selectedManifest = {
    ...manifest,
    variants: manifest.variants.filter((variant) =>
      usedVariantIds.has(variant.variantId)
    ),
    files: selectedFiles,
  };
  emitProgress("resolving", 0, selectedFiles.length);
  const initialCloudSaveContext =
    suppliedContext ??
    (await getCloudSaveGameContext(gameId.objectId, gameId.shop));
  const emulatorFileCount = selectedFiles.filter((file) =>
    isEmulatorCloudSaveRawPath(file.rawPath)
  ).length;
  if (emulatorFileCount > 0 && emulatorFileCount !== selectedFiles.length) {
    throw new Error("Mixed emulator and filesystem restores are unsupported");
  }
  const cloudSaveContext =
    emulatorFileCount > 0 &&
    !("emulator" in initialCloudSaveContext && initialCloudSaveContext.emulator)
      ? await buildLocalGameSnapshotContext(gameId.objectId, gameId.shop)
      : initialCloudSaveContext;
  const emulatorTargets =
    emulatorFileCount > 0
      ? await resolveEmulatorRestoreTargets(
          cloudSaveContext as LocalGameSnapshotContext,
          selectedFiles
        )
      : [];
  const plan =
    emulatorTargets.length > 0
      ? {
          actions: emulatorTargets.map((target) => ({
            ...target,
            targetPath: target.cardFilePath,
            restoreRootPath: target.cardFilePath,
            action: "replace" as const,
          })),
          blocked: [],
        }
      : await resolveRestoreManifestTargets(
          selectedManifest,
          cloudSaveContext.pathContext
        );
  emitProgress("resolving", plan.actions.length, selectedFiles.length);

  const restoreTargets = plan.actions.filter(
    (target) => target.action !== "skip-identical"
  );

  try {
    emitProgress("downloading", 0, restoreTargets.length);
    const downloadedFiles = await downloadRemoteSnapshotToTemp(
      snapshot.id,
      snapshot.version,
      restoreTargets,
      (processedFiles, totalFiles) =>
        emitProgress("downloading", processedFiles, totalFiles)
    );
    const downloadedFilesByContent = new Map<string, typeof downloadedFiles>();
    for (const file of downloadedFiles) {
      const key = JSON.stringify([file.hash, file.sizeBytes]);
      const existing = downloadedFilesByContent.get(key) ?? [];
      if (existing.some((item) => item.tempPath !== file.tempPath)) {
        throw new Error("Downloaded restore blob is inconsistent");
      }
      downloadedFilesByContent.set(key, [...existing, file]);
    }

    let verifiedFiles = 0;
    emitProgress("verifying", 0, downloadedFiles.length);
    await mapWithConcurrency(
      [...downloadedFilesByContent.values()],
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

    const current = await assertSnapshotStillCurrent(gameId, snapshot);
    const versionDecision = getRestoreVersionDecision(
      snapshot,
      current,
      versionChangeAttempt
    );
    if (versionDecision !== "stable") {
      if (versionDecision === "retry" && current) {
        return restoreRemoteSnapshot(
          current.id,
          gameId,
          onProgress,
          current,
          emulatorTargets.length > 0 ? undefined : cloudSaveContext,
          requestedEntryIds,
          updateAnchor,
          carriedUnresolvedEntryIds,
          1,
          assertEnvironmentCurrent
        );
      }
      throw new Error("cloud_save_restore_snapshot_changed_twice");
    }

    await assertEnvironmentCurrent?.();
    emitProgress("applying_restore", 0, plan.actions.length);
    const result =
      emulatorTargets.length > 0
        ? await applyEmulatorRestoreFiles(
            cloudSaveContext as LocalGameSnapshotContext,
            emulatorTargets,
            downloadedFiles
          )
        : await replaceRestoreTargets(
            buildRestoreReplacements(plan.actions, downloadedFiles)
          );
    emitProgress("applying_restore", plan.actions.length, plan.actions.length);
    logger.info("[Cloud Save] Restore metadata applied", {
      restoredFiles: result.restoredFiles.length,
      timestampedIdenticalFiles: result.skippedFiles.length,
      updatedDirectories: result.updatedDirectoryCount,
      metadataFailures: result.metadataFailures.length,
    });

    const blockedIds = plan.blocked.map(cloudSaveFileKey);
    const unresolvedRemoteEntryIds = [
      ...new Set([
        ...carriedUnresolvedEntryIds.filter(
          (entryId) => !selectedIds.has(entryId)
        ),
        ...blockedIds,
      ]),
    ].sort();

    const restoreSucceeded = isRestoreReplacementSuccessful(result);
    if (restoreSucceeded) {
      await assertEnvironmentCurrent?.();
      const restoredCustomRawPaths = new Set(
        plan.actions
          .map(({ rawPath }) => rawPath)
          .filter((rawPath) =>
            rawPath.startsWith(CLOUD_SAVE_CUSTOM_PATH_PREFIX)
          )
      );
      if (restoredCustomRawPaths.size > 0) {
        const restorableCustomPaths = await getRestorableCloudSaveCustomPaths(
          selectedManifest,
          cloudSaveContext.pathContext.platform
        );
        await registerCloudSaveCustomPaths(
          manifest.snapshot.shop,
          manifest.snapshot.objectId,
          restorableCustomPaths.filter(({ rawPath }) =>
            restoredCustomRawPaths.has(rawPath)
          )
        );
      }
    }
    if (restoreSucceeded && updateAnchor) {
      await assertEnvironmentCurrent?.();
      await saveCloudSaveSyncAnchor(
        manifest.snapshot.shop,
        manifest.snapshot.objectId,
        cloudSaveContext.environmentId,
        {
          schemaVersion: 4,
          environmentId: cloudSaveContext.environmentId,
          baseSnapshotId: manifest.snapshot.id,
          baseVersion: manifest.snapshot.version,
          baseAggregateHash: snapshot.aggregateHash,
          entries: manifest.files.map((file) => ({
            variantId: file.variantId,
            rawPath: file.rawPath,
            relativePath: file.relativePath,
            hash: file.hash,
            sizeBytes: file.sizeBytes,
          })),
          unresolvedRemoteEntryIds,
          updatedAt: new Date().toISOString(),
        }
      );
    }

    const partial =
      unresolvedRemoteEntryIds.length > 0 || result.metadataFailures.length > 0;
    const restoreResult: RestoreRemoteSnapshotResult = {
      ok: restoreSucceeded,
      partial,
      restoredFiles: result.restoredFiles.length,
      skippedFiles: result.skippedFiles.length,
      failedFiles: result.failedFiles.length,
      metadataFailedPaths: result.metadataFailures.length,
      blockedFiles: plan.blocked.length,
      unresolvedRemoteEntryIds,
    };
    emitProgress("completed", plan.actions.length, selectedFiles.length);
    return restoreResult;
  } finally {
    await NativeAddon.cleanupRestoreTempSnapshot(
      tempSnapshotId,
      SystemPath.getPath("temp")
    ).catch((error) =>
      logger.warn("Failed to clean cloud save restore temp files", error)
    );
  }
};
