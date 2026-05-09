import type { Download } from "./level.types";

export type DownloadPlacement =
  | "hero"
  | "queue"
  | "paused"
  | "completed"
  | "hidden";

export const isPausedHeroDownload = (download: Download) => {
  return download.status === "paused" && download.pinnedToHero === true;
};

export const isActiveLikeDownload = (download: Download) => {
  return (
    download.status === "active" ||
    download.status === "extracting" ||
    download.extracting
  );
};

export const isQueuedDownload = (download: Download) => {
  return (
    download.status === "paused" &&
    download.queued &&
    !isPausedHeroDownload(download)
  );
};

export const isPausedDownload = (download: Download) => {
  return (
    download.status === "paused" &&
    !download.queued &&
    !isPausedHeroDownload(download)
  );
};

export const isCompletedLikeDownload = (download: Download) => {
  return download.status === "complete" || download.status === "seeding";
};

export const isBigPictureCompletedLikeDownload = (download: Download) => {
  return isCompletedLikeDownload(download) || download.status === "error";
};

export type LegacyDownloadPlacement =
  | "queued"
  | "completed"
  | "hidden"
  | "unknown";

export const getLegacyDownloadPlacement = (
  download: Download
): LegacyDownloadPlacement => {
  if (download.status === "removed") {
    return "hidden";
  }

  if (
    download.queued &&
    download.status !== "complete" &&
    download.status !== "seeding"
  ) {
    return "queued";
  }

  if (download.status === "paused" || download.status === "error") {
    return "queued";
  }

  if (isCompletedLikeDownload(download)) {
    return "completed";
  }

  return "unknown";
};

export const getDownloadPlacement = (download: Download): DownloadPlacement => {
  if (download.status === "removed") {
    return "hidden";
  }

  if (isActiveLikeDownload(download)) {
    return "hero";
  }

  if (isPausedHeroDownload(download)) {
    return "hero";
  }

  if (isQueuedDownload(download)) {
    return "queue";
  }

  if (isPausedDownload(download)) {
    return "paused";
  }

  if (isBigPictureCompletedLikeDownload(download)) {
    return "completed";
  }

  return "hidden";
};
