import type {
  LocalGameSnapshotSourceFile,
  PrepareSnapshotFile,
  PrepareSnapshotResponse,
} from "../../../types/cloud-save.types";

export const validatePrepareResponse = (
  value: unknown
): PrepareSnapshotResponse => {
  if (!value || typeof value !== "object") {
    throw new Error("Invalid prepare snapshot response");
  }

  const response = value as Record<string, unknown>;
  if (
    typeof response.snapshotId !== "string" ||
    typeof response.snapshotHash !== "string" ||
    !Array.isArray(response.files)
  ) {
    throw new TypeError("Invalid prepare snapshot response");
  }

  for (const item of response.files) {
    if (!item || typeof item !== "object") {
      throw new Error("Invalid prepare snapshot file response");
    }
    const file = item as Record<string, unknown>;
    const validBase =
      typeof file.rawPath === "string" &&
      typeof file.relativePath === "string" &&
      (file.status === "skip" || file.status === "upload");
    if (
      !validBase ||
      (file.status === "upload" && typeof file.uploadUrl !== "string")
    ) {
      throw new Error("Invalid prepare snapshot file response");
    }
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
