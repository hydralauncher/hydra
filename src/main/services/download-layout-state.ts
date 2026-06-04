import {
  DEFAULT_DOWNLOAD_LAYOUT_STATE,
  getDownloadId,
  isActiveLikeDownload,
  isCompletedLikeDownload,
  isPausedDownload,
  isQueuedDownload,
  type Download,
  type DownloadLayoutState,
} from "../../types";
import { downloadLayoutStateSublevel } from "@main/level";

const DOWNLOAD_LAYOUT_STATE_KEY = "layout";

function uniqueIds(ids: string[]) {
  return [...new Set(ids)];
}

function orderDownloadsByTimestamp(downloads: Download[]) {
  return [...downloads].sort(
    (left, right) => (left.timestamp ?? 0) - (right.timestamp ?? 0)
  );
}

function mergeIdsWithFallback(downloads: Download[], preferredOrder: string[]) {
  const candidateIds = new Set(
    downloads.map((download) => getDownloadId(download))
  );
  const orderedIds: string[] = [];

  for (const id of uniqueIds(preferredOrder)) {
    if (!candidateIds.has(id)) continue;
    orderedIds.push(id);
    candidateIds.delete(id);
  }

  for (const download of orderDownloadsByTimestamp(downloads)) {
    const id = getDownloadId(download);
    if (!candidateIds.has(id)) continue;
    orderedIds.push(id);
    candidateIds.delete(id);
  }

  return orderedIds;
}

export async function getDownloadLayoutStateRecord() {
  return (
    (await downloadLayoutStateSublevel
      .get(DOWNLOAD_LAYOUT_STATE_KEY)
      .catch(() => null)) ?? DEFAULT_DOWNLOAD_LAYOUT_STATE
  );
}

export async function saveDownloadLayoutState(
  layoutState: DownloadLayoutState
) {
  await downloadLayoutStateSublevel.put(DOWNLOAD_LAYOUT_STATE_KEY, layoutState);
}

export function normalizeDownloadLayoutState(
  downloads: Download[],
  layoutState: DownloadLayoutState
): DownloadLayoutState {
  const queueDownloads = downloads.filter((download) => {
    return (
      isQueuedDownload(download) &&
      !isActiveLikeDownload(download) &&
      !isCompletedLikeDownload(download)
    );
  });
  const pausedDownloads = downloads.filter((download) => {
    return (
      isPausedDownload(download) &&
      !isActiveLikeDownload(download) &&
      !isCompletedLikeDownload(download)
    );
  });

  return {
    version: 1,
    queueOrder: mergeIdsWithFallback(queueDownloads, layoutState.queueOrder),
    pausedOrder: mergeIdsWithFallback(pausedDownloads, layoutState.pausedOrder),
  };
}

export function getQueuedDownloadsOrderedByLayout(
  downloads: Download[],
  layoutState: DownloadLayoutState
) {
  const queueDownloads = downloads.filter((download) => {
    return (
      isQueuedDownload(download) &&
      !isActiveLikeDownload(download) &&
      !isCompletedLikeDownload(download)
    );
  });
  const orderedIds = mergeIdsWithFallback(
    queueDownloads,
    layoutState.queueOrder
  );
  const downloadById = new Map(
    queueDownloads.map((download) => [getDownloadId(download), download])
  );

  return orderedIds
    .map((id) => downloadById.get(id) ?? null)
    .filter((download): download is Download => download !== null);
}

export function getPausedDownloadsOrderedByLayout(
  downloads: Download[],
  layoutState: DownloadLayoutState
) {
  const pausedDownloads = downloads.filter((download) => {
    return (
      isPausedDownload(download) &&
      !isActiveLikeDownload(download) &&
      !isCompletedLikeDownload(download)
    );
  });
  const orderedIds = mergeIdsWithFallback(
    pausedDownloads,
    layoutState.pausedOrder
  );
  const downloadById = new Map(
    pausedDownloads.map((download) => [getDownloadId(download), download])
  );

  return orderedIds
    .map((id) => downloadById.get(id) ?? null)
    .filter((download): download is Download => download !== null);
}

export function getNextQueuedDownloadFromLayout(
  downloads: Download[],
  layoutState: DownloadLayoutState
) {
  return getQueuedDownloadsOrderedByLayout(downloads, layoutState)[0] ?? null;
}

export async function getNormalizedDownloadLayoutState(downloads: Download[]) {
  const layoutState = await getDownloadLayoutStateRecord();
  return normalizeDownloadLayoutState(downloads, layoutState);
}

export async function syncDownloadLayoutState(downloads: Download[]) {
  const normalizedLayoutState =
    await getNormalizedDownloadLayoutState(downloads);

  await saveDownloadLayoutState(normalizedLayoutState);

  return normalizedLayoutState;
}

export async function removeDownloadFromLayoutState(
  download: Pick<Download, "shop" | "objectId">,
  downloads: Download[]
) {
  const layoutState = await getNormalizedDownloadLayoutState(downloads);
  const id = getDownloadId(download);

  const nextState: DownloadLayoutState = {
    version: 1,
    queueOrder: layoutState.queueOrder.filter((entryId) => entryId !== id),
    pausedOrder: layoutState.pausedOrder.filter((entryId) => entryId !== id),
  };

  await saveDownloadLayoutState(nextState);

  return nextState;
}

export async function setDownloadLayoutQueues(
  downloads: Download[],
  queueOrder: string[],
  pausedOrder: string[]
) {
  const visibleIds = new Set(
    downloads.map((download) => getDownloadId(download))
  );
  const nextState: DownloadLayoutState = normalizeDownloadLayoutState(
    downloads,
    {
      version: 1,
      queueOrder: queueOrder.filter((id) => visibleIds.has(id)),
      pausedOrder: pausedOrder.filter((id) => visibleIds.has(id)),
    }
  );

  await saveDownloadLayoutState(nextState);

  return nextState;
}
