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
  return (
    download.status === "complete" ||
    download.status === "seeding" ||
    download.status === "error"
  );
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

  if (isCompletedLikeDownload(download)) {
    return "completed";
  }

  // Legacy/raw statuses such as "waiting" are tolerated at the type boundary
  // but are not part of the official product contract or user-facing grouping.
  return "hidden";
};
