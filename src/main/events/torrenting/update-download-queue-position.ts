import { registerEvent } from "../register-event";
import { downloadsSublevel, levelKeys } from "@main/level";
import {
  isPausedDownload,
  isQueuedDownload,
  type Download,
  type GameShop,
} from "../../../types";
import { orderBy } from "lodash-es";
import { WindowManager } from "@main/services";

export const getQueuedDownloadsOrdered = (downloads: Download[]) => {
  return orderBy(
    downloads.filter((download) => isQueuedDownload(download)),
    "timestamp",
    "asc"
  );
};

export const getNextQueuedDownload = (downloads: Download[]) => {
  return getQueuedDownloadsOrdered(downloads)[0] ?? null;
};

export const getPausedDownloadsOrdered = (downloads: Download[]) => {
  return orderBy(
    downloads.filter((download) => isPausedDownload(download)),
    "timestamp",
    "asc"
  );
};

export const rewriteQueuedDownloads = async (queuedDownloads: Download[]) => {
  if (!queuedDownloads.length) return;

  const baseTimestamp =
    queuedDownloads.reduce(
      (lowestTimestamp, queuedDownload) =>
        Math.min(lowestTimestamp, queuedDownload.timestamp),
      queuedDownloads[0]?.timestamp ?? Date.now()
    ) ?? Date.now();

  await Promise.all(
    queuedDownloads.map((queuedDownload, index) =>
      downloadsSublevel.put(
        levelKeys.game(queuedDownload.shop, queuedDownload.objectId),
        {
          ...queuedDownload,
          status: "paused",
          queued: true,
          pinnedToHero: false,
          timestamp: baseTimestamp + index,
        }
      )
    )
  );
};

export const rewritePausedDownloads = async (pausedDownloads: Download[]) => {
  if (!pausedDownloads.length) return;

  const baseTimestamp =
    pausedDownloads.reduce(
      (lowestTimestamp, pausedDownload) =>
        Math.min(lowestTimestamp, pausedDownload.timestamp),
      pausedDownloads[0]?.timestamp ?? Date.now()
    ) ?? Date.now();

  await Promise.all(
    pausedDownloads.map((pausedDownload, index) =>
      downloadsSublevel.put(
        levelKeys.game(pausedDownload.shop, pausedDownload.objectId),
        {
          ...pausedDownload,
          status: "paused",
          queued: false,
          pinnedToHero: false,
          timestamp: baseTimestamp + index,
        }
      )
    )
  );
};

export const setDownloadQueuePositionInternal = async (
  shop: GameShop,
  objectId: string,
  targetIndex: number
) => {
  const gameKey = levelKeys.game(shop, objectId);

  const download = await downloadsSublevel.get(gameKey);

  if (!download || !isQueuedDownload(download)) {
    return false;
  }

  const allDownloads = await downloadsSublevel.values().all();

  const queuedDownloads = getQueuedDownloadsOrdered(allDownloads);

  const currentIndex = queuedDownloads.findIndex(
    (d) => d.shop === shop && d.objectId === objectId
  );

  if (currentIndex === -1) {
    return false;
  }

  const clampedTargetIndex = Math.max(
    0,
    Math.min(targetIndex, queuedDownloads.length - 1)
  );

  if (clampedTargetIndex === currentIndex) {
    return true;
  }

  const nextQueue = [...queuedDownloads];
  const [movedDownload] = nextQueue.splice(currentIndex, 1);

  if (!movedDownload) {
    return false;
  }

  nextQueue.splice(clampedTargetIndex, 0, movedDownload);

  await rewriteQueuedDownloads(nextQueue);

  WindowManager.sendDownloadsUpdated();

  return true;
};

export const setPausedDownloadPositionInternal = async (
  shop: GameShop,
  objectId: string,
  targetIndex: number
) => {
  const gameKey = levelKeys.game(shop, objectId);

  const download = await downloadsSublevel.get(gameKey);

  if (!download || !isPausedDownload(download)) {
    return false;
  }

  const allDownloads = await downloadsSublevel.values().all();

  const pausedDownloads = getPausedDownloadsOrdered(allDownloads);

  const currentIndex = pausedDownloads.findIndex(
    (d) => d.shop === shop && d.objectId === objectId
  );

  if (currentIndex === -1) {
    return false;
  }

  const clampedTargetIndex = Math.max(
    0,
    Math.min(targetIndex, pausedDownloads.length - 1)
  );

  if (clampedTargetIndex === currentIndex) {
    return true;
  }

  const nextPaused = [...pausedDownloads];
  const [movedDownload] = nextPaused.splice(currentIndex, 1);

  if (!movedDownload) {
    return false;
  }

  nextPaused.splice(clampedTargetIndex, 0, movedDownload);

  await rewritePausedDownloads(nextPaused);

  WindowManager.sendDownloadsUpdated();

  return true;
};

const updateDownloadQueuePosition = async (
  _event: Electron.IpcMainInvokeEvent,
  shop: GameShop,
  objectId: string,
  direction: "up" | "down"
) => {
  const allDownloads = await downloadsSublevel.values().all();

  const queuedDownloads = getQueuedDownloadsOrdered(allDownloads);

  const currentIndex = queuedDownloads.findIndex(
    (d) => d.shop === shop && d.objectId === objectId
  );

  if (currentIndex === -1) {
    return false;
  }

  const targetIndex = direction === "up" ? currentIndex - 1 : currentIndex + 1;

  return setDownloadQueuePositionInternal(shop, objectId, targetIndex);
};

registerEvent("updateDownloadQueuePosition", updateDownloadQueuePosition);
