import type { SnapshotFile } from "@types";

export const hasEligibleCloudSaveCustomPathFiles = (
  files: Pick<SnapshotFile, "rawPath">[],
  rawPath: string
) => files.some((file) => file.rawPath === rawPath);
