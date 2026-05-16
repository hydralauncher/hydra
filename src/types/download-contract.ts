import type { Download, DownloadLayoutState } from "./level.types";

export type DownloadPlacement =
  | "hero"
  | "queue"
  | "paused"
  | "completed"
  | "hidden";

export type RendererDownloadBucket =
  | "inProgress"
  | "queued"
  | "completed"
  | "hidden";

export interface BigPictureDownloadView {
  heroId: string | null;
  queueIds: string[];
  pausedIds: string[];
  completedIds: string[];
}

export const DEFAULT_DOWNLOAD_LAYOUT_STATE: DownloadLayoutState = {
  version: 1,
  queueOrder: [],
  pausedOrder: [],
};

export const getDownloadId = (
  download: Pick<Download, "shop" | "objectId">
): string => {
  return `${download.shop}:${download.objectId}`;
};

export const isActiveLikeDownload = (download: Download) => {
  return (
    download.status === "active" ||
    download.status === "extracting" ||
    download.extracting
  );
};

export const isErroredDownload = (download: Download) => {
  return download.status === "error";
};

export const isQueuedDownload = (download: Download) => {
  return (
    download.status === "paused" &&
    download.queued &&
    !isActiveLikeDownload(download)
  );
};

export const isPausedDownload = (download: Download) => {
  return (
    (download.status === "paused" && !download.queued) ||
    isErroredDownload(download)
  );
};

export const isCompletedLikeDownload = (download: Download) => {
  return download.status === "complete" || download.status === "seeding";
};

function orderIdsByLayoutState(
  downloads: Download[],
  preferredOrder: string[]
) {
  const downloadById = new Map(
    downloads.map((download) => [getDownloadId(download), download])
  );
  const fallbackIds = [...downloadById.keys()].sort((leftId, rightId) => {
    const left = downloadById.get(leftId);
    const right = downloadById.get(rightId);

    return (left?.timestamp ?? 0) - (right?.timestamp ?? 0);
  });

  const orderedIds: string[] = [];
  const seenIds = new Set<string>();

  for (const id of preferredOrder) {
    if (!downloadById.has(id) || seenIds.has(id)) continue;
    seenIds.add(id);
    orderedIds.push(id);
  }

  for (const id of fallbackIds) {
    if (seenIds.has(id)) continue;
    seenIds.add(id);
    orderedIds.push(id);
  }

  return orderedIds;
}

export const getDownloadPlacement = (download: Download): DownloadPlacement => {
  if (download.status === "removed") {
    return "hidden";
  }

  if (isActiveLikeDownload(download)) {
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

  return "hidden";
};

export const getRendererDownloadBucket = (
  download: Download,
  options: {
    hasLiveProgress?: boolean;
    isExtracting?: boolean;
  } = {}
): RendererDownloadBucket => {
  if (download.status === "removed") {
    return "hidden";
  }

  if (
    options.hasLiveProgress ||
    options.isExtracting ||
    isActiveLikeDownload(download)
  ) {
    return "inProgress";
  }

  if (isQueuedDownload(download) || isPausedDownload(download)) {
    return "queued";
  }

  if (isCompletedLikeDownload(download)) {
    return "completed";
  }

  return "hidden";
};

export const getBigPictureDownloadView = (
  downloads: Download[],
  layoutState: DownloadLayoutState
): BigPictureDownloadView => {
  const visibleDownloads = downloads.filter(
    (download) => getDownloadPlacement(download) !== "hidden"
  );
  const activeDownload =
    visibleDownloads.find((download) => isActiveLikeDownload(download)) ?? null;
  const queuedDownloads = visibleDownloads.filter((download) =>
    isQueuedDownload(download)
  );
  const pausedDownloads = visibleDownloads.filter((download) =>
    isPausedDownload(download)
  );
  const completedIds = visibleDownloads
    .filter((download) => isCompletedLikeDownload(download))
    .map((download) => getDownloadId(download));
  const queueIds = orderIdsByLayoutState(
    queuedDownloads,
    layoutState.queueOrder
  );
  const pausedIds = orderIdsByLayoutState(
    pausedDownloads,
    layoutState.pausedOrder
  );

  if (activeDownload) {
    return {
      heroId: getDownloadId(activeDownload),
      queueIds,
      pausedIds,
      completedIds,
    };
  }

  const heroId = queueIds[0] ?? pausedIds[0] ?? null;

  return {
    heroId,
    queueIds: heroId ? queueIds.filter((id) => id !== heroId) : queueIds,
    pausedIds: heroId ? pausedIds.filter((id) => id !== heroId) : pausedIds,
    completedIds,
  };
};
