import { downloadsSublevel, levelKeys } from "@main/level";
import { DownloadManager } from "./download/download-manager";
import { WindowManager } from "./window-manager";
import { logger } from "./logger";
import {
  DEFAULT_DOWNLOAD_LAYOUT_STATE,
  getBigPictureDownloadView,
  getDownloadId,
  isActiveLikeDownload,
  isCompletedLikeDownload,
  type Download,
  type DownloadLayoutState,
  type GameShop,
} from "../../types";
import {
  getNextQueuedDownloadFromLayout,
  getNormalizedDownloadLayoutState,
  getPausedDownloadsOrderedByLayout,
  getQueuedDownloadsOrderedByLayout,
  removeDownloadFromLayoutState,
  saveDownloadLayoutState,
  setDownloadLayoutQueues,
  syncDownloadLayoutState,
} from "./download-layout-state";

export type ResumeDownloadStrategy = "interruptActive" | "queueIfActive";

function getGameKey(download: Pick<Download, "shop" | "objectId">) {
  return levelKeys.game(download.shop, download.objectId);
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

function asPausedDownload(
  download: Download,
  status: "paused" | "error" = "paused"
) {
  return {
    ...download,
    status,
    queued: false,
    pinnedToHero: false,
    extracting: false,
    extractionProgress: 0,
  };
}

function withInsertedId(ids: string[], id: string, targetIndex?: number) {
  const nextIds = ids.filter((entryId) => entryId !== id);
  const resolvedTargetIndex = Math.max(
    0,
    Math.min(targetIndex ?? nextIds.length, nextIds.length)
  );

  nextIds.splice(resolvedTargetIndex, 0, id);

  return nextIds;
}

export class DownloadOrchestrator {
  private static async getAllDownloads() {
    return downloadsSublevel.values().all();
  }

  private static async getDownload(shop: GameShop, objectId: string) {
    return downloadsSublevel
      .get(levelKeys.game(shop, objectId))
      .catch(() => null);
  }

  private static async activateDownload(download: Download) {
    const activeDownload: Download = {
      ...download,
      status: "active",
      queued: false,
      pinnedToHero: false,
      extracting: false,
      extractionProgress: 0,
      timestamp: Date.now(),
    };

    await downloadsSublevel.put(getGameKey(download), activeDownload);

    try {
      await DownloadManager.resumeDownload(activeDownload);
    } catch (error) {
      const downloadId = getDownloadId(download);
      await downloadsSublevel.put(getGameKey(download), {
        ...activeDownload,
        status: "error",
        queued: false,
      });

      const downloads = await this.getAllDownloads();
      const layoutState = await getNormalizedDownloadLayoutState(downloads);
      await setDownloadLayoutQueues(
        downloads,
        layoutState.queueOrder.filter((id) => id !== downloadId),
        [
          downloadId,
          ...layoutState.pausedOrder.filter((id) => id !== downloadId),
        ]
      );

      WindowManager.sendDownloadsUpdated();
      throw error;
    }

    return activeDownload;
  }

  private static async setDownloadPausedState(
    download: Download,
    options: {
      queued?: boolean;
      status?: "paused" | "error";
    } = {}
  ) {
    const nextDownload = options.queued
      ? asQueuedDownload(download)
      : asPausedDownload(download, options.status);

    await downloadsSublevel.put(getGameKey(download), nextDownload);

    return nextDownload;
  }

  private static async getDownloadsWithLayout() {
    const downloads = await this.getAllDownloads();
    const layoutState = await syncDownloadLayoutState(downloads);

    return { downloads, layoutState };
  }

  private static async startNextQueuedDownload(downloads?: Download[]) {
    const currentDownloads = downloads ?? (await this.getAllDownloads());
    const layoutState =
      await getNormalizedDownloadLayoutState(currentDownloads);
    const nextDownload = getNextQueuedDownloadFromLayout(
      currentDownloads,
      layoutState
    );

    if (!nextDownload) {
      WindowManager.sendDownloadsUpdated();
      return null;
    }

    await this.activateDownload(nextDownload);
    WindowManager.sendDownloadsUpdated();

    return nextDownload;
  }

  private static async queueDownload(
    download: Download,
    options: {
      toFront?: boolean;
      targetIndex?: number;
    } = {}
  ) {
    const nextDownload = await this.setDownloadPausedState(download, {
      queued: true,
    });
    const downloads = await this.getAllDownloads();
    const layoutState = await getNormalizedDownloadLayoutState(downloads);
    const nextQueueOrder = withInsertedId(
      layoutState.queueOrder,
      getDownloadId(download),
      options.toFront ? 0 : options.targetIndex
    );

    await setDownloadLayoutQueues(
      downloads,
      nextQueueOrder,
      layoutState.pausedOrder.filter((id) => id !== getDownloadId(download))
    );

    return nextDownload;
  }

  private static async pauseDownload(
    download: Download,
    options: {
      reason?: "paused" | "error";
      queueActiveReplacement?: boolean;
      startNextQueued?: boolean;
    } = {}
  ) {
    const shouldPauseRuntime = isActiveLikeDownload(download);

    if (shouldPauseRuntime) {
      await DownloadManager.pauseDownload(getGameKey(download));
      WindowManager.sendToAppWindows("on-download-progress", null);
    }

    const nextDownload = await this.setDownloadPausedState(download, {
      queued: options.queueActiveReplacement,
      status: options.reason === "error" ? "error" : "paused",
    });

    if (options.queueActiveReplacement) {
      await this.queueDownload(nextDownload, { toFront: true });
    } else {
      const downloads = await this.getAllDownloads();
      const layoutState = await getNormalizedDownloadLayoutState(downloads);
      const nextPausedOrder = withInsertedId(
        layoutState.pausedOrder,
        getDownloadId(download),
        0
      );

      await setDownloadLayoutQueues(
        downloads,
        layoutState.queueOrder.filter((id) => id !== getDownloadId(download)),
        nextPausedOrder
      );
    }

    if (options.startNextQueued) {
      const downloads = await this.getAllDownloads();
      await this.startNextQueuedDownload(
        downloads.filter(
          (entry) => getDownloadId(entry) !== getDownloadId(nextDownload)
        )
      );
    }

    WindowManager.sendDownloadsUpdated();

    return nextDownload;
  }

  static async bootstrapDownloadsOnStartup() {
    const downloads = await this.getAllDownloads();
    let interruptedDownloadId: string | null = null;

    for (const download of downloads) {
      const nextDownload: Download = { ...download };
      let shouldPersist = false;

      if (nextDownload.extracting) {
        nextDownload.extracting = false;
        shouldPersist = true;
      }

      if (nextDownload.pinnedToHero) {
        nextDownload.pinnedToHero = false;
        shouldPersist = true;
      }

      if (nextDownload.status === "active") {
        nextDownload.status = "paused";
        nextDownload.queued = interruptedDownloadId == null;
        interruptedDownloadId ??= getDownloadId(nextDownload);
        shouldPersist = true;
      }

      if (
        (nextDownload.status === "removed" ||
          nextDownload.status === "complete" ||
          nextDownload.status === "seeding" ||
          nextDownload.status === "error") &&
        nextDownload.queued
      ) {
        nextDownload.queued = false;
        shouldPersist = true;
      }

      if (shouldPersist) {
        await downloadsSublevel.put(getGameKey(nextDownload), nextDownload);
      }
    }

    const normalizedDownloads = await this.getAllDownloads();
    await syncDownloadLayoutState(normalizedDownloads);

    if (interruptedDownloadId) {
      return (
        normalizedDownloads.find(
          (download) => getDownloadId(download) === interruptedDownloadId
        ) ?? null
      );
    }

    const layoutState =
      await getNormalizedDownloadLayoutState(normalizedDownloads);
    return getNextQueuedDownloadFromLayout(normalizedDownloads, layoutState);
  }

  static async getLayoutState() {
    const downloads = await this.getAllDownloads();
    return syncDownloadLayoutState(downloads);
  }

  static async startPreparedDownload(download: Download) {
    const { downloads } = await this.getDownloadsWithLayout();
    const currentActiveDownload =
      downloads.find(
        (entry) =>
          isActiveLikeDownload(entry) &&
          getDownloadId(entry) !== getDownloadId(download)
      ) ?? null;

    if (currentActiveDownload) {
      await this.queueDownload(download);
      WindowManager.sendDownloadsUpdated();
      return { ok: true };
    }

    await this.activateDownload(download);
    const nextDownloads = await this.getAllDownloads();
    await removeDownloadFromLayoutState(download, nextDownloads);
    WindowManager.sendDownloadsUpdated();

    return { ok: true };
  }

  static async enqueuePreparedDownload(download: Download) {
    await this.queueDownload(download);
    WindowManager.sendDownloadsUpdated();

    return { ok: true };
  }

  static async resumeDownload(
    shop: GameShop,
    objectId: string,
    strategy: ResumeDownloadStrategy = "interruptActive"
  ) {
    const download = await this.getDownload(shop, objectId);

    if (
      !download ||
      !["paused", "active", "error"].includes(download.status ?? "") ||
      download.progress === 1
    ) {
      return false;
    }

    const downloads = await this.getAllDownloads();
    const currentActiveDownload =
      downloads.find(
        (entry) =>
          isActiveLikeDownload(entry) &&
          getDownloadId(entry) !== getDownloadId(download)
      ) ?? null;

    if (currentActiveDownload && strategy === "queueIfActive") {
      await this.queueDownload(download, { toFront: true });
      WindowManager.sendDownloadsUpdated();
      return true;
    }

    if (currentActiveDownload) {
      await this.pauseDownload(currentActiveDownload, {
        reason: "paused",
        startNextQueued: false,
      });
    }

    await this.activateDownload(download);
    const nextDownloads = await this.getAllDownloads();
    await removeDownloadFromLayoutState(download, nextDownloads);
    WindowManager.sendDownloadsUpdated();

    return true;
  }

  static async pauseDownloadById(shop: GameShop, objectId: string) {
    const download = await this.getDownload(shop, objectId);
    if (!download) return false;

    await this.pauseDownload(download, {
      reason: "paused",
      startNextQueued: true,
    });

    return true;
  }

  static async cancelDownloadById(shop: GameShop, objectId: string) {
    const download = await this.getDownload(shop, objectId);
    if (!download) return false;

    const downloadId = getDownloadId(download);
    const wasActive = isActiveLikeDownload(download);

    await DownloadManager.cancelDownload(getGameKey(download));
    WindowManager.sendToAppWindows("on-download-progress", null);

    await downloadsSublevel.put(getGameKey(download), {
      ...download,
      status: "removed",
      queued: false,
      pinnedToHero: false,
      shouldSeed: false,
      extracting: false,
    });

    const downloads = await this.getAllDownloads();
    await removeDownloadFromLayoutState(
      { shop: download.shop, objectId: download.objectId },
      downloads.filter((entry) => getDownloadId(entry) !== downloadId)
    );

    if (wasActive) {
      await this.startNextQueuedDownload(
        downloads.filter((entry) => getDownloadId(entry) !== downloadId)
      );
      return true;
    }

    WindowManager.sendDownloadsUpdated();
    return true;
  }

  static async moveDownloadPlacement(
    shop: GameShop,
    objectId: string,
    targetArea: "hero" | "queue" | "paused",
    targetIndex?: number
  ) {
    const download = await this.getDownload(shop, objectId);

    if (
      !download ||
      isCompletedLikeDownload(download) ||
      download.status === "removed"
    ) {
      return false;
    }

    const { downloads, layoutState } = await this.getDownloadsWithLayout();
    const currentActiveDownload =
      downloads.find(
        (entry) =>
          isActiveLikeDownload(entry) &&
          getDownloadId(entry) !== getDownloadId(download)
      ) ?? null;
    const view = getBigPictureDownloadView(downloads, layoutState);
    const downloadId = getDownloadId(download);
    const isHero = view.heroId === downloadId;
    const queueIds = view.queueIds.filter((id) => id !== downloadId);
    const pausedIds = view.pausedIds.filter((id) => id !== downloadId);

    if (targetArea === "hero") {
      if (currentActiveDownload) {
        await this.pauseDownload(currentActiveDownload, {
          reason: "paused",
          queueActiveReplacement: true,
          startNextQueued: false,
        });
      }

      await this.activateDownload(download);
      const nextDownloads = await this.getAllDownloads();
      await setDownloadLayoutQueues(nextDownloads, queueIds, pausedIds);
      WindowManager.sendDownloadsUpdated();
      return true;
    }

    if (targetArea === "queue") {
      if (isHero && isActiveLikeDownload(download)) {
        await DownloadManager.pauseDownload(getGameKey(download));
        WindowManager.sendToAppWindows("on-download-progress", null);
        await this.setDownloadPausedState(download, { queued: true });
      } else {
        await this.setDownloadPausedState(download, { queued: true });
      }

      const nextDownloads = await this.getAllDownloads();
      await setDownloadLayoutQueues(
        nextDownloads,
        withInsertedId(queueIds, downloadId, targetIndex),
        pausedIds
      );

      if (isHero) {
        await this.startNextQueuedDownload(
          nextDownloads.filter((entry) => getDownloadId(entry) !== downloadId)
        );
      } else {
        WindowManager.sendDownloadsUpdated();
      }

      return true;
    }

    if (isHero && isActiveLikeDownload(download)) {
      await this.pauseDownload(download, {
        reason: "paused",
        startNextQueued: true,
      });
    } else {
      await this.setDownloadPausedState(download, { queued: false });
    }

    const nextDownloads = await this.getAllDownloads();
    await setDownloadLayoutQueues(
      nextDownloads,
      queueIds,
      withInsertedId(pausedIds, downloadId, targetIndex)
    );
    WindowManager.sendDownloadsUpdated();

    return true;
  }

  static async setQueuePosition(
    shop: GameShop,
    objectId: string,
    targetIndex: number
  ) {
    const { downloads, layoutState } = await this.getDownloadsWithLayout();
    const queueDownloads = getQueuedDownloadsOrderedByLayout(
      downloads,
      layoutState
    );
    const downloadId = levelKeys.game(shop, objectId);

    if (
      !queueDownloads.some((download) => getDownloadId(download) === downloadId)
    ) {
      return false;
    }

    await setDownloadLayoutQueues(
      downloads,
      withInsertedId(layoutState.queueOrder, downloadId, targetIndex),
      layoutState.pausedOrder
    );
    WindowManager.sendDownloadsUpdated();

    return true;
  }

  static async setPausedPosition(
    shop: GameShop,
    objectId: string,
    targetIndex: number
  ) {
    const { downloads, layoutState } = await this.getDownloadsWithLayout();
    const pausedDownloads = getPausedDownloadsOrderedByLayout(
      downloads,
      layoutState
    );
    const downloadId = levelKeys.game(shop, objectId);

    if (
      !pausedDownloads.some(
        (download) => getDownloadId(download) === downloadId
      )
    ) {
      return false;
    }

    await setDownloadLayoutQueues(
      downloads,
      layoutState.queueOrder,
      withInsertedId(layoutState.pausedOrder, downloadId, targetIndex)
    );
    WindowManager.sendDownloadsUpdated();

    return true;
  }

  static async handleDownloadFailure(downloadId: string) {
    const download = await downloadsSublevel.get(downloadId).catch(() => null);
    if (!download) return;

    try {
      await this.pauseDownload(download, {
        reason: "error",
        startNextQueued: true,
      });
    } catch (error) {
      logger.error(
        "[DownloadOrchestrator] Failed to handle download failure",
        error
      );
    }
  }

  static async syncAfterDownloadRemoved(
    download: Pick<Download, "shop" | "objectId">
  ) {
    const downloads = await this.getAllDownloads();
    await removeDownloadFromLayoutState(download, downloads);
  }

  static async rebuildLayoutState(
    defaultState: DownloadLayoutState = DEFAULT_DOWNLOAD_LAYOUT_STATE
  ) {
    const downloads = await this.getAllDownloads();
    await saveDownloadLayoutState(defaultState);
    return syncDownloadLayoutState(downloads);
  }
}
