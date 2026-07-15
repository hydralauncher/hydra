import type {
  LocalGameSnapshotSourceFile,
  PrepareSnapshotFile,
  PrepareSnapshotResponse,
} from "../../../types/cloud-save.types";

const isNonEmptyString = (value: unknown): value is string =>
  typeof value === "string" && value.length > 0;

const isHttpUrl = (value: unknown): value is string => {
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

export const validatePrepareResponse = (
  value: unknown
): PrepareSnapshotResponse => {
  if (!value || typeof value !== "object") {
    throw new Error("Invalid prepare snapshot response");
  }

  const response = value as Record<string, unknown>;
  if (
    !isNonEmptyString(response.snapshotId) ||
    !isNonEmptyString(response.snapshotHash) ||
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
    const { rawPath, relativePath, status, uploadUrl } = file;
    if (
      !isNonEmptyString(rawPath) ||
      !isNonEmptyString(relativePath) ||
      (status !== "skip" && status !== "upload") ||
      (status === "upload" && !isHttpUrl(uploadUrl))
    ) {
      throw new Error("Invalid prepare snapshot file response");
    }

    const key = fileKey(rawPath, relativePath);
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
    const uploads = groups.get(item.source.hash) ?? [];
    uploads.push({ file: item.file, source: item.source });
    groups.set(item.source.hash, uploads);
  }

  return groups;
};
