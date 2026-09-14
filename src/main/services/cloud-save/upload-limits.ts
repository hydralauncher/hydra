import type { SnapshotFile } from "@types";

export const MAX_CLOUD_SAVE_SNAPSHOT_FILE_COUNT = 500;
export const MAX_CLOUD_SAVE_SNAPSHOT_SIZE_BYTES = 2_147_483_647;

export const assertCloudSaveUploadWithinLimits = (
  files: ReadonlyArray<Pick<SnapshotFile, "sizeBytes">>
) => {
  if (files.length > MAX_CLOUD_SAVE_SNAPSHOT_FILE_COUNT) {
    throw new Error("cloud_save_too_many_files");
  }

  let totalSizeBytes = 0;
  for (const file of files) {
    totalSizeBytes += file.sizeBytes;
    if (totalSizeBytes > MAX_CLOUD_SAVE_SNAPSHOT_SIZE_BYTES) {
      throw new Error("cloud_save_snapshot_too_large");
    }
  }
};
