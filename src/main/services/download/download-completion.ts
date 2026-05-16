import type { Download } from "@types";

interface DownloadCompletionInput {
  usingJsDownloader: boolean;
  isCheckingFiles: boolean;
  isDownloadingMetadata: boolean;
  progress: number;
  downloadStatus: Download["status"];
}

export function shouldFinalizeDownload({
  usingJsDownloader,
  isCheckingFiles,
  isDownloadingMetadata,
  progress,
  downloadStatus,
}: DownloadCompletionInput) {
  if (isCheckingFiles || isDownloadingMetadata) {
    return false;
  }

  if (usingJsDownloader) {
    return downloadStatus === "complete";
  }

  return progress === 1 || downloadStatus === "complete";
}
