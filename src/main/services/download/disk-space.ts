import { MINIMUM_FREE_DISK_SPACE_BYTES } from "@shared";
import type { Download } from "@types";
import { getDiskUsage } from "../disk-usage";

export const DISK_SPACE_CHECK_INTERVAL_MS = 10_000;

export interface DownloadDiskSpace {
  freeBytes: number;
  requiredBytes: number;
  hasEnoughSpace: boolean;
}

const getRemainingBytes = (download: Download) => {
  const fileSize = download.selectedFilesSize ?? download.fileSize ?? 0;

  if (fileSize <= 0) return 0;

  return Math.max(0, fileSize - (download.bytesDownloaded ?? 0));
};

export const getDownloadDiskSpace = async (
  download: Download
): Promise<DownloadDiskSpace | null> => {
  const usage = await getDiskUsage(download.downloadPath);

  if (!usage) return null;

  const requiredBytes = Math.max(
    getRemainingBytes(download),
    MINIMUM_FREE_DISK_SPACE_BYTES
  );

  return {
    freeBytes: usage.free,
    requiredBytes,
    hasEnoughSpace: usage.free >= requiredBytes,
  };
};
