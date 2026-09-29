import type { Download } from "@types";
import { DownloadManager } from "@main/services/download/download-manager";
import { isDebridPendingError } from "@main/services/download/debrid-pending";
import { Downloader } from "@shared";

export function preparesRealDebridInBackground(download: Download): boolean {
  return (
    download.downloader === Downloader.RealDebrid &&
    download.uri.startsWith("magnet:")
  );
}

export async function validateDownloadOrMarkPending(
  download: Download
): Promise<void> {
  try {
    await DownloadManager.validateDownloadUrl(download);
  } catch (error) {
    if (!isDebridPendingError(error, download.downloader)) throw error;
    download.awaitingDebrid = true;
  }
}
