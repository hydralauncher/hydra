import type {
  CloudSaveInsights,
  GameShop,
  LocalGameSnapshotSourceFile,
  RemoteSnapshotSummary,
  RestoreManifestResponse,
  SaveSummary,
} from "@types";
import { logger } from "@main/services/logger";
import { SystemPath } from "@main/services/system-path";

import { NativeAddon } from "../native-addon";
import { analyzeCloudSaveState } from "./analyze-cloud-save-state";
import { assertCloudSaveSubscription } from "./cloud-save-access";
import { cloudSaveFileKey } from "./cloud-save-contract";
import { downloadRemoteSnapshotToTemp } from "./download-remote-snapshot-to-temp";
import {
  blobKey,
  modifiedAtMs,
  summarizeLocalSourceFiles,
  summarizeSaveFiles,
} from "./save-insights-files";

/** Cloud files that differ from this PC are downloaded to read them, up to this size. */
const MAX_REMOTE_INSIGHTS_DOWNLOAD_BYTES = 96 * 1024 * 1024;
const MAX_CACHED_REMOTE_SUMMARIES = 16;

const remoteSummaryCache = new Map<string, SaveSummary | null>();

const remoteSummaryCacheKey = (
  shop: GameShop,
  objectId: string,
  snapshot: RemoteSnapshotSummary
) =>
  JSON.stringify([
    shop,
    objectId,
    snapshot.id,
    snapshot.version,
    snapshot.aggregateHash,
  ]);

const rememberRemoteSummary = (key: string, summary: SaveSummary | null) => {
  remoteSummaryCache.delete(key);
  remoteSummaryCache.set(key, summary);
  if (remoteSummaryCache.size > MAX_CACHED_REMOTE_SUMMARIES) {
    const oldest = remoteSummaryCache.keys().next().value;
    if (oldest !== undefined) remoteSummaryCache.delete(oldest);
  }
};

const summarizeRemoteManifest = async (
  shop: GameShop,
  objectId: string,
  snapshot: RemoteSnapshotSummary,
  manifest: RestoreManifestResponse,
  sourceFiles: LocalGameSnapshotSourceFile[]
) => {
  const localByBlob = new Map(sourceFiles.map((file) => [blobKey(file), file]));
  const missing = manifest.files.filter(
    (file) => !localByBlob.has(blobKey(file))
  );
  const missingBytes = missing.reduce((sum, file) => sum + file.sizeBytes, 0);
  if (missingBytes > MAX_REMOTE_INSIGHTS_DOWNLOAD_BYTES) {
    logger.info("[Cloud Save] Skipping cloud save insights download", {
      shop,
      objectId,
      missingBytes,
    });
    return null;
  }

  const tempSnapshotId = `${snapshot.id}-${snapshot.version}-insights`;
  try {
    const downloaded = missing.length
      ? await downloadRemoteSnapshotToTemp(
          snapshot.id,
          snapshot.version,
          missing,
          undefined,
          tempSnapshotId
        )
      : [];
    const tempPathByKey = new Map(
      downloaded.map((file) => [cloudSaveFileKey(file), file.tempPath])
    );
    return await summarizeSaveFiles(
      shop,
      objectId,
      manifest.files.flatMap((file) => {
        const path =
          localByBlob.get(blobKey(file))?.absolutePath ??
          tempPathByKey.get(cloudSaveFileKey(file));
        return path
          ? [
              {
                rawPath: file.rawPath,
                relativePath: file.relativePath,
                path,
                sizeBytes: file.sizeBytes,
                modifiedAtMs: modifiedAtMs(file.lastModifiedAt),
              },
            ]
          : [];
      })
    );
  } finally {
    if (missing.length) {
      await NativeAddon.cleanupRestoreTempSnapshot(
        tempSnapshotId,
        SystemPath.getPath("temp")
      ).catch((error) =>
        logger.warn("Failed to clean cloud save insights temp files", error)
      );
    }
  }
};

export const getCloudSaveInsights = async (
  objectId: string,
  shop: GameShop
): Promise<CloudSaveInsights> => {
  assertCloudSaveSubscription();
  const analysis = await analyzeCloudSaveState(objectId, shop);
  const sourceFiles = analysis.localSnapshotContext.sourceFiles;
  const snapshot = analysis.activeRemoteSnapshot;

  const readRemote = async () => {
    if (!snapshot || !analysis.remoteManifest) return null;
    const cacheKey = remoteSummaryCacheKey(shop, objectId, snapshot);
    if (remoteSummaryCache.has(cacheKey)) {
      return remoteSummaryCache.get(cacheKey) ?? null;
    }
    try {
      const summary = await summarizeRemoteManifest(
        shop,
        objectId,
        snapshot,
        analysis.remoteManifest,
        sourceFiles
      );
      rememberRemoteSummary(cacheKey, summary);
      return summary;
    } catch (error) {
      logger.warn("[Cloud Save] Failed to read cloud save insights", {
        shop,
        objectId,
        error,
      });
      return null;
    }
  };

  const [local, remote] = await Promise.all([
    summarizeLocalSourceFiles(shop, objectId, sourceFiles),
    readRemote(),
  ]);

  return { local, remote };
};
