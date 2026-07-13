import { HydraApi } from "@main/services/hydra-api";
import { SystemPath } from "@main/services/system-path";
import type {
  DownloadedRestoreFile,
  RestoreDownloadUrlFile,
  RestoreManifestFile,
} from "@types";

import { NativeAddon } from "../native-addon";

const isNonEmptyString = (value: unknown): value is string =>
  typeof value === "string" && value.length > 0;

const isDownloadUrl = (value: unknown): value is string => {
  if (!isNonEmptyString(value)) return false;
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
  }
};

const fileKey = (rawPath: string, relativePath: string) =>
  JSON.stringify([rawPath, relativePath]);

const validateDownloadUrls = (value: unknown): RestoreDownloadUrlFile[] => {
  if (!Array.isArray(value)) {
    throw new TypeError("Invalid restore download URLs response");
  }

  const seenPaths = new Set<string>();
  return value.map((file) => {
    if (!file || typeof file !== "object") {
      throw new Error("Invalid restore download URL file");
    }
    const item = file as Record<string, unknown>;
    if (
      !isNonEmptyString(item.rawPath) ||
      !isNonEmptyString(item.relativePath) ||
      !isNonEmptyString(item.hash) ||
      typeof item.sizeBytes !== "number" ||
      !Number.isFinite(item.sizeBytes) ||
      item.sizeBytes <= 0 ||
      !isDownloadUrl(item.downloadUrl)
    ) {
      throw new Error("Invalid restore download URL file");
    }

    const key = fileKey(item.rawPath, item.relativePath);
    if (seenPaths.has(key)) {
      throw new Error("Duplicate restore download URL file");
    }
    seenPaths.add(key);

    return item as unknown as RestoreDownloadUrlFile;
  });
};

export const downloadRemoteSnapshotToTemp = async (
  snapshotId: string,
  requestedFiles?: RestoreManifestFile[]
): Promise<DownloadedRestoreFile[]> => {
  if (requestedFiles?.length === 0) return [];
  const files = validateDownloadUrls(
    await HydraApi.get<unknown>("/profile/cloud-saves/snapshot-download-urls", {
      snapshotId,
    })
  );
  const requestedByPath = requestedFiles
    ? new Map(
        requestedFiles.map((file) => [
          fileKey(file.rawPath, file.relativePath),
          file,
        ])
      )
    : null;
  const selectedFiles = requestedByPath
    ? files.filter((file) =>
        requestedByPath.has(fileKey(file.rawPath, file.relativePath))
      )
    : files;
  if (requestedByPath) {
    if (selectedFiles.length !== requestedByPath.size) {
      throw new Error("Missing restore download URL file");
    }
    for (const file of selectedFiles) {
      const requested = requestedByPath.get(
        fileKey(file.rawPath, file.relativePath)
      );
      if (
        !requested ||
        requested.hash !== file.hash ||
        requested.sizeBytes !== file.sizeBytes
      ) {
        throw new Error("Restore download URL file does not match manifest");
      }
    }
  }
  const tempRoot = SystemPath.getPath("temp");
  const downloadedByHash = new Map<
    string,
    { sizeBytes: number; tempPath: string }
  >();
  const downloadedFiles: DownloadedRestoreFile[] = [];

  for (const file of selectedFiles) {
    const existing = downloadedByHash.get(file.hash);
    if (existing && existing.sizeBytes !== file.sizeBytes) {
      throw new Error("Restore blob hash has inconsistent sizes");
    }

    const tempPath =
      existing?.tempPath ??
      (await NativeAddon.downloadRestoreBlobToTemp(
        snapshotId,
        file.hash,
        file.downloadUrl,
        tempRoot
      ));
    downloadedByHash.set(file.hash, {
      sizeBytes: file.sizeBytes,
      tempPath,
    });
    downloadedFiles.push({
      rawPath: file.rawPath,
      relativePath: file.relativePath,
      hash: file.hash,
      sizeBytes: file.sizeBytes,
      tempPath,
    });
  }

  return downloadedFiles;
};
