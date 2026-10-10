import { MINIMUM_FREE_DISK_SPACE_BYTES } from "@shared";
import type { Download } from "@types";
import { getDiskUsage } from "../disk-usage";

export const DISK_SPACE_CHECK_INTERVAL_MS = 10_000;

export interface DownloadDiskSpace {
  freeBytes: number;
  requiredBytes: number;
  hasEnoughSpace: boolean;
}

const getRemainingBytes = (
  download: Download,
  live?: { bytesDownloaded?: number | null; fileSize?: number | null }
) => {
  const liveSize =
    live?.fileSize != null && live.fileSize > 0 ? live.fileSize : undefined;
  const fileSize =
    download.selectedFilesSize ?? liveSize ?? download.fileSize ?? 0;

  if (fileSize <= 0) return 0;

  const bytes = live?.bytesDownloaded ?? download.bytesDownloaded ?? 0;

  return Math.max(0, fileSize - bytes);
};

export const getDownloadDiskSpace = async (
  download: Download,
  live?: { bytesDownloaded?: number | null; fileSize?: number | null }
): Promise<DownloadDiskSpace | null> => {
  const usage = await getDiskUsage(download.downloadPath);

  if (!usage) return null;

  const requiredBytes = Math.max(
    getRemainingBytes(download, live),
    MINIMUM_FREE_DISK_SPACE_BYTES
  );

  return {
    freeBytes: usage.free,
    requiredBytes,
    hasEnoughSpace: usage.free >= requiredBytes,
  };
};
