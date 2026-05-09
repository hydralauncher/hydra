import { registerEvent } from "../register-event";
import { downloadsSublevel, levelKeys } from "../../level";
import { DownloadManager, WindowManager, logger } from "../../services";
import {
  getDownloadPlacement,
  isActiveLikeDownload,
  type DownloadPlacement,
  type Download,
  type GameShop,
} from "../../../types";
import {
  getNextQueuedDownload,
  getPausedDownloadsOrdered,
  getQueuedDownloadsOrdered,
  rewritePausedDownloads,
  rewriteQueuedDownloads,
} from "./update-download-queue-position";

type DownloadPlacementArea = "hero" | "queue" | "paused";

function getGameKey(download: Pick<Download, "shop" | "objectId">) {
  return levelKeys.game(download.shop, download.objectId);
}

function isExtractingDownload(download: Download) {
  return download.extracting || download.status === "extracting";
}

function asQueuedDownload(download: Download) {
  return {
    ...download,
    status: "paused" as const,
    queued: true,
    pinnedToHero: false,
    extracting: false,
    extractionProgress: 0,
  };
}

function asPausedDownload(download: Download) {
  return {
    ...download,
    status: "paused" as const,
    queued: false,
    pinnedToHero: false,
    extracting: false,
    extractionProgress: 0,
  };
}

function asPausedHeroDownload(download: Download) {
  return {
    ...download,
    status: "paused" as const,
    queued: false,
    pinnedToHero: true,
    extracting: false,
    extractionProgress: 0,
  };
}

function normalizeTargetIndex(targetIndex: number, length: number) {
  return Math.max(0, Math.min(targetIndex, length));
}

function insertDownloadAt<T>(items: T[], item: T, targetIndex: number): T[] {
  const nextItems = [...items];
  nextItems.splice(
    normalizeTargetIndex(targetIndex, nextItems.length),
    0,
    item
  );
  return nextItems;
}

function insertIntoQueue(
  queuedDownloads: Download[],
  download: Download,
  targetIndex: number
) {
  return insertDownloadAt(
    queuedDownloads,
    asQueuedDownload(download),
    targetIndex
  );
}

function insertIntoPaused(
  pausedDownloads: Download[],
  download: Download,
  targetIndex: number
) {
  return insertDownloadAt(
    pausedDownloads,
    asPausedDownload(download),
    targetIndex
  );
}

function isSameDownload(
  left: Pick<Download, "shop" | "objectId">,
  right: Pick<Download, "shop" | "objectId">
) {
  return left.shop === right.shop && left.objectId === right.objectId;
}

function buildListsAfterHeroPromotion(
  currentHeroDownload: Download | null,
  queuedDownloadsWithoutSource: Download[],
  pausedDownloadsWithoutSource: Download[]
) {
  const nextQueue =
    currentHeroDownload && isActiveLikeDownload(currentHeroDownload)
      ? [asQueuedDownload(currentHeroDownload), ...queuedDownloadsWithoutSource]
      : queuedDownloadsWithoutSource;
  const nextPaused =
    currentHeroDownload && !isActiveLikeDownload(currentHeroDownload)
      ? [asPausedDownload(currentHeroDownload), ...pausedDownloadsWithoutSource]
      : pausedDownloadsWithoutSource;

  return { nextQueue, nextPaused };
}

async function persistListsAfterHeroPromotion(
  currentHeroDownload: Download | null,
  queuedDownloadsWithoutSource: Download[],
  pausedDownloadsWithoutSource: Download[]
) {
  const { nextQueue, nextPaused } = buildListsAfterHeroPromotion(
    currentHeroDownload,
    queuedDownloadsWithoutSource,
    pausedDownloadsWithoutSource
  );

  await rewriteQueuedDownloads(nextQueue);

  if (currentHeroDownload && !isActiveLikeDownload(currentHeroDownload)) {
    await rewritePausedDownloads(nextPaused);
  }
}

async function activateDownload(download: Download) {
  await DownloadManager.resumeDownload(download);

  const activeDownload = {
    ...download,
    status: "active" as const,
    queued: true,
    pinnedToHero: false,
    extracting: false,
    extractionProgress: 0,
    timestamp: Date.now(),
  };

  await downloadsSublevel.put(getGameKey(download), activeDownload);

  return activeDownload;
}

async function restoreHeroDownload(download: Download | null) {
  if (!download) return;

  try {
    if (isActiveLikeDownload(download)) {
      await activateDownload(download);
      return;
    }

    await downloadsSublevel.put(
      getGameKey(download),
      asPausedHeroDownload(download)
    );
  } catch (error) {
    logger.error(
      "[Downloads] Failed to restore previous hero download after placement error",
      error
    );
  }
}

async function restoreDownloadPlacement(
  download: Download,
  placement: "hero" | "queue" | "paused"
) {
  if (placement === "hero") {
    await restoreHeroDownload(download);
    return;
  }

  const restoredDownload =
    placement === "queue"
      ? asQueuedDownload(download)
      : asPausedDownload(download);

  await downloadsSublevel.put(getGameKey(download), restoredDownload);
}

async function rollbackHeroPromotionFailure(
  sourceDownload: Download,
  sourcePlacement: "queue" | "paused",
  currentHeroDownload: Download | null
) {
  await restoreDownloadPlacement(sourceDownload, sourcePlacement);
  await restoreHeroDownload(currentHeroDownload);
}

async function rollbackHeroDemotionFailure(
  sourceDownload: Download,
  nextQueuedDownload: Download | null
) {
  if (nextQueuedDownload) {
    await restoreDownloadPlacement(nextQueuedDownload, "queue");
  }

  await restoreHeroDownload(sourceDownload);
}

async function pauseActiveDownload(download: Download) {
  await DownloadManager.pauseDownload(getGameKey(download));
  WindowManager.sendToAppWindows("on-download-progress", null);
}

async function finalizeSuccess() {
  WindowManager.sendDownloadsUpdated();
  return true;
}

function assertPlaceablePlacement(
  placement: DownloadPlacement
): placement is "hero" | "queue" | "paused" {
  return (
    placement === "hero" || placement === "queue" || placement === "paused"
  );
}

async function moveDownloadPlacement(
  _event: Electron.IpcMainInvokeEvent,
  shop: GameShop,
  objectId: string,
  targetArea: DownloadPlacementArea,
  targetQueueIndex?: number
) {
  const sourceKey = levelKeys.game(shop, objectId);
  const sourceDownload = await downloadsSublevel.get(sourceKey);

  if (!sourceDownload) {
    return false;
  }

  const allDownloads = await downloadsSublevel.values().all();
  const currentHeroDownload =
    allDownloads.find(
      (download) =>
        getDownloadPlacement(download) === "hero" &&
        !(download.shop === shop && download.objectId === objectId)
    ) ?? null;
  const activeDownload =
    allDownloads.find(
      (download) =>
        isActiveLikeDownload(download) &&
        !(download.shop === shop && download.objectId === objectId)
    ) ?? null;
  const sourcePlacement = getDownloadPlacement(sourceDownload);

  if (!assertPlaceablePlacement(sourcePlacement)) {
    return false;
  }

  if (isExtractingDownload(sourceDownload)) {
    return false;
  }

  if (
    targetArea === "hero" &&
    currentHeroDownload &&
    isActiveLikeDownload(currentHeroDownload) &&
    isExtractingDownload(currentHeroDownload)
  ) {
    return false;
  }

  const queuedDownloads = getQueuedDownloadsOrdered(allDownloads);
  const pausedDownloads = getPausedDownloadsOrdered(allDownloads);
  const sourceQueueIndex = queuedDownloads.findIndex((download) =>
    isSameDownload(download, sourceDownload)
  );
  const sourcePausedIndex = pausedDownloads.findIndex((download) =>
    isSameDownload(download, sourceDownload)
  );
  const queuedDownloadsWithoutSource = queuedDownloads.filter(
    (download) => !isSameDownload(download, sourceDownload)
  );
  const pausedDownloadsWithoutSource = pausedDownloads.filter(
    (download) => !isSameDownload(download, sourceDownload)
  );

  if (sourcePlacement === "hero" && targetArea === "hero") {
    return true;
  }

  if (targetArea === "paused") {
    if (typeof targetQueueIndex !== "number") {
      return false;
    }

    if (
      sourcePlacement === "paused" &&
      sourcePausedIndex === targetQueueIndex
    ) {
      return true;
    }
  }

  if (targetArea === "queue") {
    if (typeof targetQueueIndex !== "number") {
      return false;
    }

    if (sourcePlacement === "queue" && sourceQueueIndex === targetQueueIndex) {
      return true;
    }
  }

  if (sourcePlacement === "paused") {
    if (targetArea === "paused") {
      const nextPaused = insertIntoPaused(
        pausedDownloadsWithoutSource,
        sourceDownload,
        targetQueueIndex!
      );
      await rewritePausedDownloads(nextPaused);
      return finalizeSuccess();
    }

    if (targetArea === "queue") {
      const nextQueue = insertIntoQueue(
        queuedDownloadsWithoutSource,
        sourceDownload,
        targetQueueIndex!
      );
      await rewriteQueuedDownloads(nextQueue);
      return finalizeSuccess();
    }

    if (activeDownload) {
      await pauseActiveDownload(activeDownload);
    }

    try {
      await activateDownload(sourceDownload);
      await persistListsAfterHeroPromotion(
        currentHeroDownload,
        queuedDownloadsWithoutSource,
        pausedDownloadsWithoutSource
      );
      return finalizeSuccess();
    } catch (error) {
      await rollbackHeroPromotionFailure(
        sourceDownload,
        sourcePlacement,
        currentHeroDownload
      );
      logger.error(
        "[Downloads] Failed to promote paused download to hero",
        error
      );
      return false;
    }
  }

  if (sourcePlacement === "queue") {
    if (targetArea === "queue") {
      const nextQueue = insertIntoQueue(
        queuedDownloadsWithoutSource,
        sourceDownload,
        targetQueueIndex!
      );
      await rewriteQueuedDownloads(nextQueue);
      return finalizeSuccess();
    }

    if (targetArea === "paused") {
      await rewriteQueuedDownloads(queuedDownloadsWithoutSource);
      const nextPaused = insertIntoPaused(
        pausedDownloadsWithoutSource,
        sourceDownload,
        targetQueueIndex!
      );
      await rewritePausedDownloads(nextPaused);
      return finalizeSuccess();
    }

    if (activeDownload) {
      await pauseActiveDownload(activeDownload);
    }

    try {
      await activateDownload(sourceDownload);
      await persistListsAfterHeroPromotion(
        currentHeroDownload,
        queuedDownloadsWithoutSource,
        pausedDownloadsWithoutSource
      );
      return finalizeSuccess();
    } catch (error) {
      await rollbackHeroPromotionFailure(
        sourceDownload,
        sourcePlacement,
        currentHeroDownload
      );
      logger.error(
        "[Downloads] Failed to promote queued download to hero",
        error
      );
      return false;
    }
  }

  if (isActiveLikeDownload(sourceDownload)) {
    await pauseActiveDownload(sourceDownload);
  }

  const nextQueuedDownload = getNextQueuedDownload(
    queuedDownloadsWithoutSource
  );
  const remainingQueuedDownloads = queuedDownloadsWithoutSource.filter(
    (download) =>
      !nextQueuedDownload || !isSameDownload(download, nextQueuedDownload)
  );

  if (nextQueuedDownload) {
    try {
      await activateDownload(nextQueuedDownload);
    } catch (error) {
      await rollbackHeroDemotionFailure(sourceDownload, nextQueuedDownload);
      logger.error(
        "[Downloads] Failed to activate next queued download after demoting hero",
        error
      );
      return false;
    }
  }

  if (targetArea === "paused") {
    await rewriteQueuedDownloads(remainingQueuedDownloads);
    const nextPaused = insertIntoPaused(
      pausedDownloadsWithoutSource,
      sourceDownload,
      targetQueueIndex!
    );
    await rewritePausedDownloads(nextPaused);
    return finalizeSuccess();
  }

  if (targetArea === "queue") {
    const nextQueue = insertIntoQueue(
      remainingQueuedDownloads,
      sourceDownload,
      targetQueueIndex!
    );
    await rewriteQueuedDownloads(nextQueue);
    return finalizeSuccess();
  }

  await restoreHeroDownload(sourceDownload);
  return finalizeSuccess();
}

registerEvent("moveDownloadPlacement", moveDownloadPlacement);
