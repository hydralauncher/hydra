import type { Download } from "@types";

interface DownloadCompletionInput {
  usingJsDownloader: boolean;
  usingEpicDownloader?: boolean;
  isCheckingFiles: boolean;
  isDownloadingMetadata: boolean;
  progress: number;
  downloadStatus: Download["status"];
}

export function shouldFinalizeDownload({
  usingJsDownloader,
  usingEpicDownloader,
  isCheckingFiles,
  isDownloadingMetadata,
  progress,
  downloadStatus,
}: DownloadCompletionInput) {
  if (isCheckingFiles || isDownloadingMetadata) {
    return false;
  }

  if (usingJsDownloader || usingEpicDownloader) {
    return downloadStatus === "complete";
  }

  return progress === 1 || downloadStatus === "complete";
}
