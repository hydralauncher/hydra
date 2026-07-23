import type {
  LocalGameSnapshotSourceFile,
  PrepareSnapshotFile,
  PrepareSnapshotResponse,
} from "@types";

import {
  CLOUD_SAVE_HASH_PATTERN,
  cloudSaveFileKey,
  isNonEmptyString,
} from "./cloud-save-contract.js";

const isHttpUrl = (value: unknown): value is string => {
  if (!isNonEmptyString(value)) return false;
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
  }
};

const validateIdentity = (file: Record<string, unknown>) =>
  isNonEmptyString(file.variantId) &&
  CLOUD_SAVE_HASH_PATTERN.test(file.variantId) &&
  isNonEmptyString(file.rawPath) &&
  isNonEmptyString(file.relativePath);

export const validatePrepareResponse = (
  value: unknown
): PrepareSnapshotResponse => {
  if (!value || typeof value !== "object") {
    throw new Error("Invalid prepare snapshot response");
  }
  const response = value as Record<string, unknown>;
  if (
    Object.keys(response).some(
      (key) => !["pendingSnapshotId", "snapshotHash", "files"].includes(key)
    ) ||
    !isNonEmptyString(response.pendingSnapshotId) ||
    !isNonEmptyString(response.snapshotHash) ||
    !CLOUD_SAVE_HASH_PATTERN.test(response.snapshotHash) ||
    !Array.isArray(response.files)
  ) {
    throw new TypeError("Invalid prepare snapshot response");
  }

  const seenFiles = new Set<string>();
  for (const item of response.files) {
    if (!item || typeof item !== "object") {
      throw new Error("Invalid prepare snapshot file response");
    }
    const file = item as Record<string, unknown>;
    if (!validateIdentity(file)) {
      throw new Error("Invalid prepare snapshot file identity");
    }
    const commonKeys = ["variantId", "rawPath", "relativePath", "status"];
    if (file.status === "skip") {
      if (
        Object.keys(file).some((key) => !commonKeys.includes(key)) ||
        Object.keys(file).length !== commonKeys.length
      ) {
        throw new Error("Invalid skipped prepare snapshot file");
      }
    } else if (file.status === "upload") {
      const headers = file.requiredHeaders as
        | Record<string, unknown>
        | undefined;
      if (
        Object.keys(file).some(
          (key) =>
            ![...commonKeys, "uploadUrl", "requiredHeaders"].includes(key)
        ) ||
        !isHttpUrl(file.uploadUrl) ||
        !headers ||
        Object.keys(headers).length !== 2 ||
        !/^(0|[1-9]\d*)$/.test(String(headers["Content-Length"] ?? "")) ||
        !isNonEmptyString(headers["x-amz-checksum-sha256"]) ||
        !/^[A-Za-z0-9+/]{43}=$/.test(headers["x-amz-checksum-sha256"])
      ) {
        throw new Error("Invalid upload prepare snapshot file");
      }
    } else {
      throw new Error("Invalid prepare snapshot file status");
    }

    const key = cloudSaveFileKey({
      variantId: file.variantId as string,
      rawPath: file.rawPath as string,
      relativePath: file.relativePath as string,
    });
    if (seenFiles.has(key)) {
      throw new Error("Duplicate prepare snapshot file response");
    }
    seenFiles.add(key);
  }

  return value as PrepareSnapshotResponse;
};

export type PreparedSnapshotSource = {
  file: PrepareSnapshotFile;
  source: LocalGameSnapshotSourceFile;
};

export const groupUploadsByHash = (items: PreparedSnapshotSource[]) => {
  const groups = new Map<
    string,
    Array<{
      file: Extract<PrepareSnapshotFile, { status: "upload" }>;
      source: LocalGameSnapshotSourceFile;
    }>
  >();

  for (const item of items) {
    if (item.file.status !== "upload") continue;
    const contentKey = JSON.stringify([
      item.source.hash,
      item.source.sizeBytes,
    ]);
    const uploads = groups.get(contentKey) ?? [];
    uploads.push({ file: item.file, source: item.source });
    groups.set(contentKey, uploads);
  }
  return groups;
};
