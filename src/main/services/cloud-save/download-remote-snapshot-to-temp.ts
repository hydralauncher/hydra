import { HydraApi } from "@main/services/hydra-api";
import { SystemPath } from "@main/services/system-path";
import type {
  DownloadedRestoreFile,
  RestoreDownloadUrlFile,
  RestoreManifestFile,
} from "@types";

import { NativeAddon } from "../native-addon";
import { cloudSaveFileKey, validateSnapshotFile } from "./cloud-save-contract";
import {
  mapWithConcurrency,
  MAX_CONCURRENT_RESTORE_OPERATIONS,
} from "./map-with-concurrency";

const isDownloadUrl = (value: unknown): value is string => {
  if (typeof value !== "string" || !value) return false;
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
  }
};

const validateDownloadUrls = (value: unknown): RestoreDownloadUrlFile[] => {
  if (!Array.isArray(value)) {
    throw new TypeError("Invalid restore download URLs response");
  }
  const seenIds = new Set<string>();
  return value.map((item) => {
    if (!item || typeof item !== "object") {
      throw new Error("Invalid restore download URL file");
    }
    const record = item as Record<string, unknown>;
    if (
      Object.keys(record).length !== 7 ||
      !isDownloadUrl(record.downloadUrl)
    ) {
      throw new Error("Invalid restore download URL file");
    }
    const snapshotFile = validateSnapshotFile({
      variantId: record.variantId,
      rawPath: record.rawPath,
      relativePath: record.relativePath,
      hash: record.hash,
      sizeBytes: record.sizeBytes,
      lastModifiedAt: record.lastModifiedAt,
    });
    const key = cloudSaveFileKey(snapshotFile);
    if (seenIds.has(key)) {
      throw new Error("Duplicate restore download URL file");
    }
    seenIds.add(key);
    return { ...snapshotFile, downloadUrl: record.downloadUrl };
  });
};

export const downloadRemoteSnapshotToTemp = async (
  snapshotId: string,
  snapshotVersion: number,
  requestedFiles?: RestoreManifestFile[],
  onProgress?: (processedFiles: number, totalFiles: number) => void
): Promise<DownloadedRestoreFile[]> => {
  if (requestedFiles?.length === 0) return [];
  const files = validateDownloadUrls(
    await HydraApi.get<unknown>(
      "/profile/cloud-saves/snapshot-download-urls",
      { snapshotId },
      { needsAuth: true, needsSubscription: true }
    )
  );
  const requestedById = requestedFiles
    ? new Map(
        requestedFiles.map((file) => [cloudSaveFileKey(file), file] as const)
      )
    : null;
  const selectedFiles = requestedById
    ? files.filter((file) => requestedById.has(cloudSaveFileKey(file)))
    : files;
  if (requestedById) {
    if (selectedFiles.length !== requestedById.size) {
      throw new Error("Missing restore download URL file");
    }
    for (const file of selectedFiles) {
      const requested = requestedById.get(cloudSaveFileKey(file));
      if (
        requested?.hash !== file.hash ||
        requested?.sizeBytes !== file.sizeBytes ||
        requested.lastModifiedAt !== file.lastModifiedAt
      ) {
        throw new Error("Restore download URL file does not match manifest");
      }
    }
  }

  const tempRoot = SystemPath.getPath("temp");
  const tempSnapshotId = `${snapshotId}-${snapshotVersion}`;
  const filesByBlob = new Map<string, RestoreDownloadUrlFile[]>();
  for (const file of selectedFiles) {
    const key = JSON.stringify([file.hash, file.sizeBytes]);
    filesByBlob.set(key, [...(filesByBlob.get(key) ?? []), file]);
  }

  const groups = [...filesByBlob.values()];
  let processedFiles = 0;
  const downloadedGroups = await mapWithConcurrency(
    groups,
    MAX_CONCURRENT_RESTORE_OPERATIONS,
    async (group) => {
      const [file] = group;
      const tempPath = await NativeAddon.downloadRestoreBlobToTemp(
        tempSnapshotId,
        file.hash,
        file.downloadUrl,
        tempRoot
      );
      return { key: JSON.stringify([file.hash, file.sizeBytes]), tempPath };
    },
    (_result, group) => {
      processedFiles += group.length;
      onProgress?.(processedFiles, selectedFiles.length);
    }
  );
  const tempPathByBlob = new Map(
    downloadedGroups.map(({ key, tempPath }) => [key, tempPath])
  );

  return selectedFiles.map((file) => {
    const tempPath = tempPathByBlob.get(
      JSON.stringify([file.hash, file.sizeBytes])
    );
    if (!tempPath) throw new Error("Missing downloaded restore blob");
    return { ...file, tempPath };
  });
};
