import { downloadsSublevel, levelKeys } from "@main/level";
import { withDownloadActivation } from "./download/download-activation";
import { DownloadManager } from "./download/download-manager";
import { isDebridPendingError } from "./download/debrid-files";
import { WindowManager } from "./window-manager";
import { logger } from "./logger";
import { Downloader } from "@shared";
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

const NO_INTERNET_GRACE_MS = 15000;
const RECONNECT_DEBOUNCE_MS = 2000;
const DEBRID_PREPARATION_WINDOW_MS = 5 * 60 * 1000;
const DEBRID_READINESS_POLL_MS = 5000;

export class DownloadOrchestrator {
  static preparesRealDebridInBackground(download: Download): boolean {
    return (
      download.downloader === Downloader.RealDebrid &&
      download.uri.startsWith("magnet:")
    );
  }

  static async validateDownloadOrMarkPending(
    download: Download
  ): Promise<void> {
    try {
      await DownloadManager.validateDownloadUrl(download);
    } catch (error) {
      if (!isDebridPendingError(error, download.downloader)) throw error;
      download.awaitingDebrid = true;
    }
  }

  private static readonly backgroundStartVersions = new Map<string, number>();
  private static readonly pendingBackgroundStarts = new Map<string, symbol>();
  private static readonly preparationControllers = new Map<
    string,
    AbortController
  >();
  private static readonly lastDebridPollAt = new Map<string, number>();

  private static invalidateBackgroundStart(downloadKey: string) {
    this.pendingBackgroundStarts.delete(downloadKey);
    this.preparationControllers.get(downloadKey)?.abort();
    this.preparationControllers.delete(downloadKey);
    this.backgroundStartVersions.set(
      downloadKey,
      (this.backgroundStartVersions.get(downloadKey) ?? 0) + 1
    );
  }

  private static beginPreparation(downloadKey: string) {
    this.invalidateBackgroundStart(downloadKey);
    const version = this.backgroundStartVersions.get(downloadKey);
    const controller = new AbortController();
    this.preparationControllers.set(downloadKey, controller);
    return {
      signal: controller.signal,
      controller,
      isCurrent: () =>
        !controller.signal.aborted &&
        this.backgroundStartVersions.get(downloadKey) === version,
      hasCurrentVersion: () =>
        this.backgroundStartVersions.get(downloadKey) === version,
      dispose: () => {
        if (this.preparationControllers.get(downloadKey) === controller) {
          this.preparationControllers.delete(downloadKey);
        }
      },
    };
  }

  static cancelPendingDebridPreparations() {
    for (const key of this.preparationControllers.keys()) {
      this.invalidateBackgroundStart(key);
    }
    this.clearReconnectGrace();
  }
  private static isOnline = true;
  private static reconnectGraceTimer: NodeJS.Timeout | null = null;
  private static lastReconnectAt = 0;

  static onNetworkStatusChanged(payload: {
    online: boolean;
    switched?: boolean;
  }) {
    const { online } = payload;

    if (!DownloadManager.isJsDownloadActive) {
      this.isOnline = online;
      this.clearReconnectGrace();
      return;
    }

    if (!online) {
      if (this.isOnline) {
        logger.log(
          "[DownloadOrchestrator] Connection lost during download; waiting for it to come back"
        );
      }
      this.isOnline = false;
      DownloadManager.notifyReconnecting(true);

      if (!this.reconnectGraceTimer) {
        this.reconnectGraceTimer = setTimeout(() => {
          this.reconnectGraceTimer = null;
          if (this.isOnline) return;

          if (!DownloadManager.isActiveDownloadReconnecting()) {
            this.isOnline = true;
            return;
          }

          void this.stopActiveDownloadForNoNetwork();
        }, NO_INTERNET_GRACE_MS);
      }
      return;
    }

    this.isOnline = true;
    this.clearReconnectGrace();

    const now = Date.now();
    if (now - this.lastReconnectAt < RECONNECT_DEBOUNCE_MS) return;
    this.lastReconnectAt = now;

    logger.log(
      "[DownloadOrchestrator] Connection available; resuming the active download"
    );
    DownloadManager.reconnectActiveDownload();
  }

  private static clearReconnectGrace() {
    if (this.reconnectGraceTimer) {
      clearTimeout(this.reconnectGraceTimer);
      this.reconnectGraceTimer = null;
    }
  }

  private static async stopActiveDownloadForNoNetwork() {
    const downloadId = DownloadManager.getActiveDownloadId();
    if (!downloadId) return;

    const download = await downloadsSublevel.get(downloadId).catch(() => null);
    if (!download) return;

    logger.log(
      "[DownloadOrchestrator] No connection after the grace window; pausing the download"
    );
    await this.pauseDownload(download, {
      reason: "paused",
      startNextQueued: false,
    });
  }

  private static async getAllDownloads() {
    return downloadsSublevel.values().all();
  }

  private static async getDownload(shop: GameShop, objectId: string) {
    return downloadsSublevel
      .get(levelKeys.game(shop, objectId))
      .catch(() => null);
  }

  private static async isAwaitingDebridReady(
    download: Download,
    signal?: AbortSignal
  ) {
    if (!download.awaitingDebrid) return true;

    try {
      if (
        download.downloader === Downloader.RealDebrid &&
        download.uri.startsWith("magnet:")
      ) {
        return await DownloadManager.prepareRealDebridDownload(
          download,
          signal
        );
      }
      await DownloadManager.validateDownloadUrl(download, signal);
      return true;
    } catch (error) {
      if (isDebridPendingError(error, download.downloader)) return false;

      throw error;
    }
  }

  private static async activateDownload(
    download: Download,
    isCurrent: () => boolean = () => true,
    signal?: AbortSignal
  ): Promise<Download | null> {
    if (!signal) {
      const preparation = this.beginPreparation(getGameKey(download));
      try {
        return await this.activateDownload(
          download,
          () => isCurrent() && preparation.isCurrent(),
          preparation.signal
        );
      } finally {
        preparation.dispose();
      }
    }
    if (!isCurrent()) return null;
    // A repeated manual action must retain the downloader already owning this slot.
    if (DownloadManager.hasRunningDownload(getGameKey(download))) {
      return download;
    }
    const activeDownload: Download = {
      ...download,
      awaitingDebrid: false,
      debridAutoResume: false,
      debridQueueOnly: undefined,
      debridPreparationDeadline: undefined,
      status: "active",
      queued: false,
      pinnedToHero: false,
      extracting: false,
      extractionProgress: 0,
      timestamp: Date.now(),
    };

    await downloadsSublevel.put(getGameKey(download), activeDownload);
    if (!isCurrent()) return null;

    try {
      await DownloadManager.resumeDownload(activeDownload, signal);
    } catch (error) {
      if (isDebridPendingError(error, download.downloader)) {
        if (!isCurrent()) return null;
        await this.saveAwaitingDebridDownload(
          {
            ...activeDownload,
            debridAutoResume: download.debridAutoResume,
            debridPreparationDeadline: download.debridPreparationDeadline,
          },
          isCurrent
        );
        return null;
      }

      const downloadId = getDownloadId(download);
      if (!isCurrent()) return null;
      await downloadsSublevel.put(getGameKey(download), {
        ...activeDownload,
        status: "error",
        queued: false,
        awaitingDebrid: false,
        debridAutoResume: false,
        debridQueueOnly: undefined,
        debridPreparationDeadline: undefined,
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

  private static async restoreInterruptedDownload(download: Download | null) {
    if (!download) return;

    try {
      const restored = await this.activateDownload(download);
      if (restored) {
        const downloads = await this.getAllDownloads();
        await removeDownloadFromLayoutState(download, downloads);
        WindowManager.sendDownloadsUpdated();
      }
    } catch (error) {
      logger.error(
        "[DownloadOrchestrator] Could not restore the interrupted download",
        error
      );
    }
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

  private static startNextQueuedDownload(downloads?: Download[]) {
    return withDownloadActivation(() =>
      this.activateNextQueuedDownload(downloads)
    );
  }

  private static async activateNextQueuedDownload(
    downloads?: Download[],
    prepared?: { id: string; isCurrent: () => boolean; signal: AbortSignal }
  ) {
    if (prepared && !prepared.isCurrent()) return null;
    const currentDownloads = downloads ?? (await this.getAllDownloads());
    if (
      DownloadManager.hasActiveDownload() ||
      currentDownloads.some(isActiveLikeDownload)
    )
      return null;
    const layoutState =
      await getNormalizedDownloadLayoutState(currentDownloads);
    if (DownloadManager.hasActiveDownload()) return null;
    const nextDownload = getNextQueuedDownloadFromLayout(
      currentDownloads,
      layoutState
    );
    if (!nextDownload) {
      WindowManager.sendDownloadsUpdated();
      return null;
    }
    const nextPreparation =
      prepared?.id === getDownloadId(nextDownload) ? prepared : undefined;
    const activated = await this.activateDownload(
      nextDownload,
      nextPreparation?.isCurrent,
      nextPreparation?.signal
    );
    if (activated) {
      WindowManager.sendDownloadsUpdated();
      return nextDownload;
    }
    return this.activateNextQueuedDownload(
      await this.getAllDownloads(),
      prepared
    );
  }

  private static async queueDownload(
    download: Download,
    options: {
      toFront?: boolean;
      targetIndex?: number;
    } = {}
  ) {
    const nextDownload = await this.setDownloadPausedState(
      { ...download, debridQueueOnly: undefined },
      { queued: true }
    );
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

    DownloadManager.clearQueueVerifyAttempt(download);

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
    this.invalidateBackgroundStart(getGameKey(download));
    const shouldPauseRuntime = isActiveLikeDownload(download);

    if (shouldPauseRuntime) {
      await DownloadManager.pauseDownload(getGameKey(download));
      WindowManager.sendToAppWindows("on-download-progress", null);
    }

    const savedDownload = shouldPauseRuntime
      ? ((await this.getDownload(download.shop, download.objectId)) ?? download)
      : download;
    const nextDownload = await this.setDownloadPausedState(
      {
        ...savedDownload,
        debridAutoResume: false,
        debridQueueOnly: undefined,
        debridPreparationDeadline: undefined,
      },
      {
        queued: options.queueActiveReplacement,
        status: options.reason === "error" ? "error" : "paused",
      }
    );

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

    if (options.startNextQueued && !DownloadManager.hasActiveDownload()) {
      const downloads = await this.getAllDownloads();
      if (!downloads.some(isActiveLikeDownload)) {
        await this.startNextQueuedDownload(
          downloads.filter(
            (entry) => getDownloadId(entry) !== getDownloadId(nextDownload)
          )
        );
      }
    }

    WindowManager.sendDownloadsUpdated();

    return nextDownload;
  }

  private static isTerminalDownload(download: Download) {
    return ["removed", "complete", "seeding", "error"].includes(
      download.status ?? ""
    );
  }

  private static normalizeAwaitingStartupDownload(download: Download) {
    if (!download.awaitingDebrid) return;
    if (this.isTerminalDownload(download)) {
      download.awaitingDebrid = false;
      download.debridAutoResume = false;
      download.debridQueueOnly = undefined;
      download.debridPreparationDeadline = undefined;
      return;
    }
    download.status = "paused";
    download.queued = false;
    if (
      download.debridAutoResume === true &&
      (!Number.isFinite(download.debridPreparationDeadline) ||
        download.debridPreparationDeadline! <= Date.now())
    ) {
      download.debridAutoResume = false;
      download.debridQueueOnly = undefined;
      download.debridPreparationDeadline = undefined;
    }
  }

  private static normalizeStartupDownload(
    download: Download,
    queueInterrupted: boolean
  ): Download {
    const nextDownload = { ...download };
    if (nextDownload.extracting) nextDownload.extracting = false;
    if (nextDownload.pinnedToHero) nextDownload.pinnedToHero = false;
    this.normalizeAwaitingStartupDownload(nextDownload);
    if (nextDownload.status === "active") {
      nextDownload.status = "paused";
      nextDownload.queued = queueInterrupted;
    }
    if (this.isTerminalDownload(nextDownload) && nextDownload.queued)
      nextDownload.queued = false;
    return nextDownload;
  }

  static async bootstrapDownloadsOnStartup() {
    const downloads = await this.getAllDownloads();
    let interruptedDownloadId: string | null = null;

    const changedDownloads = downloads
      .map((download) => {
        const nextDownload = this.normalizeStartupDownload(
          download,
          interruptedDownloadId == null
        );
        if (download.status === "active" && !download.awaitingDebrid)
          interruptedDownloadId ??= getDownloadId(nextDownload);
        return { download, nextDownload };
      })
      .filter(({ download, nextDownload }) =>
        Object.keys(nextDownload).some(
          (key) => download[key] !== nextDownload[key]
        )
      );
    await Promise.all(
      changedDownloads.map(({ nextDownload }) =>
        downloadsSublevel.put(getGameKey(nextDownload), nextDownload)
      )
    );

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

  private static async prepareRealDebridForQueue(
    download: Download,
    isCurrent: () => boolean,
    signal?: AbortSignal
  ): Promise<boolean> {
    if (
      download.downloader !== Downloader.RealDebrid ||
      !download.uri.startsWith("magnet:")
    ) {
      return true;
    }

    try {
      const ready = await DownloadManager.prepareRealDebridDownload(
        download,
        signal
      );
      if (!isCurrent()) return false;
      if (!ready) {
        await this.saveAwaitingDebridDownload(download, isCurrent);
        return false;
      }
      return true;
    } catch (error) {
      if (!isCurrent()) return false;
      if (isDebridPendingError(error, download.downloader)) {
        await this.saveAwaitingDebridDownload(download, isCurrent);
        return false;
      }
      await downloadsSublevel.put(getGameKey(download), {
        ...download,
        status: "error",
        queued: false,
        awaitingDebrid: false,
        debridAutoResume: false,
        debridQueueOnly: undefined,
        debridPreparationDeadline: undefined,
      });
      WindowManager.sendDownloadsUpdated();
      throw error;
    }
  }

  static async startPreparedDownload(
    download: Download,
    isCurrent: () => boolean = () => true,
    signal?: AbortSignal
  ): Promise<{ ok: boolean }> {
    if (!signal) {
      const preparation = this.beginPreparation(getGameKey(download));
      try {
        return await this.startPreparedDownload(
          download,
          () => isCurrent() && preparation.isCurrent(),
          preparation.signal
        );
      } finally {
        preparation.dispose();
      }
    }
    if (!(await this.prepareRealDebridForQueue(download, isCurrent, signal))) {
      return { ok: true };
    }
    return withDownloadActivation(async () => {
      if (!isCurrent()) return { ok: true };
      const current = await this.getDownload(download.shop, download.objectId);
      if (!isCurrent()) return { ok: true };
      if (
        current &&
        (isActiveLikeDownload(current) || this.isTerminalDownload(current))
      ) {
        return { ok: true };
      }
      await this.queueDownload(download);
      if (!isCurrent()) return { ok: true };
      // Read the slot after preparation and queue persistence. Completion can
      // happen during either wait, including after its empty-queue check.
      if (!download.debridQueueOnly) {
        await this.activateNextQueuedDownload(undefined, {
          id: getDownloadId(download),
          isCurrent,
          signal,
        });
      }
      WindowManager.sendDownloadsUpdated();
      return { ok: true };
    });
  }

  private static beginBackgroundPreparation(
    download: Download,
    request: symbol
  ) {
    const key = getGameKey(download);
    return withDownloadActivation(async () => {
      try {
        const current = await this.getDownload(
          download.shop,
          download.objectId
        );
        if (this.pendingBackgroundStarts.get(key) !== request) return null;
        if (
          current &&
          (isActiveLikeDownload(current) || this.isTerminalDownload(current))
        ) {
          return null;
        }
        const preparation = this.beginPreparation(key);
        try {
          // Persist waiting intent before readiness so completion and restart cannot
          // pick an item whose files are still being prepared.
          await this.saveAwaitingDebridDownload(
            download,
            preparation.isCurrent
          );
          return preparation;
        } catch (error) {
          preparation.dispose();
          throw error;
        }
      } finally {
        if (this.pendingBackgroundStarts.get(key) === request) {
          this.pendingBackgroundStarts.delete(key);
        }
      }
    });
  }

  static startPreparedDownloadInBackground(download: Download) {
    const request = Symbol();
    this.pendingBackgroundStarts.set(getGameKey(download), request);
    const start = async () => {
      const preparation = await this.beginBackgroundPreparation(
        download,
        request
      );
      if (!preparation) return;
      try {
        if (!preparation.isCurrent()) return;
        await this.startPreparedDownload(
          download,
          preparation.isCurrent,
          preparation.signal
        );
      } catch (error) {
        if (preparation.isCurrent()) {
          logger.error("Failed to prepare queued download", error);
        }
      } finally {
        preparation.dispose();
      }
    };
    void start().catch((error) => {
      logger.error("Failed to save background download preparation", error);
    });
  }

  static async enqueuePreparedDownload(download: Download) {
    const queuedDownload = { ...download, debridQueueOnly: true };
    if (download.awaitingDebrid) {
      await this.saveAwaitingDebridDownload(queuedDownload);
    } else if (this.preparesRealDebridInBackground(download)) {
      this.startPreparedDownloadInBackground(queuedDownload);
    } else {
      await this.queueDownload(download);
    }
    WindowManager.sendDownloadsUpdated();

    return { ok: true };
  }

  static async saveAwaitingDebridDownload(
    download: Download,
    isCurrent: () => boolean = () => true
  ) {
    if (!isCurrent()) return null;
    const nextDownload = await this.setDownloadPausedState(
      {
        ...download,
        awaitingDebrid: true,
        debridAutoResume: true,
        debridPreparationDeadline:
          download.debridAutoResume === true &&
          Number.isFinite(download.debridPreparationDeadline)
            ? download.debridPreparationDeadline
            : Date.now() + DEBRID_PREPARATION_WINDOW_MS,
      },
      { queued: false }
    );
    if (!isCurrent()) return null;
    const downloads = await this.getAllDownloads();
    const layoutState = await getNormalizedDownloadLayoutState(downloads);
    await setDownloadLayoutQueues(
      downloads,
      layoutState.queueOrder.filter((id) => id !== getDownloadId(download)),
      withInsertedId(layoutState.pausedOrder, getDownloadId(download), 0)
    );
    WindowManager.sendDownloadsUpdated();

    return nextDownload;
  }

  private static async saveDebridPreparationError(
    download: Download,
    isCurrent: () => boolean
  ) {
    if (!isCurrent()) return;
    await this.setDownloadPausedState(
      {
        ...download,
        awaitingDebrid: false,
        debridAutoResume: false,
        debridQueueOnly: undefined,
        debridPreparationDeadline: undefined,
      },
      { status: "error" }
    );
    if (!isCurrent()) return;
    await syncDownloadLayoutState(await this.getAllDownloads());
    WindowManager.sendDownloadsUpdated();
  }

  private static async expireDebridPreparation(download: Download) {
    const current = await this.getDownload(download.shop, download.objectId);
    if (
      !current?.awaitingDebrid ||
      current.debridAutoResume !== true ||
      current.status !== "paused" ||
      current.debridPreparationDeadline !== download.debridPreparationDeadline
    ) {
      return;
    }
    await downloadsSublevel.put(getGameKey(current), {
      ...current,
      queued: false,
      debridAutoResume: false,
      debridQueueOnly: undefined,
      debridPreparationDeadline: undefined,
    });
    WindowManager.sendDownloadsUpdated();
  }

  private static async waitForDebridReadiness(
    download: Download,
    signal: AbortSignal
  ): Promise<boolean> {
    signal.throwIfAborted();
    // The signal also stops this wait if a provider ignores cancellation.
    return new Promise<boolean>((resolve, reject) => {
      const onAbort = () => {
        signal.removeEventListener("abort", onAbort);
        reject(signal.reason);
      };
      signal.addEventListener("abort", onAbort, { once: true });
      this.isAwaitingDebridReady(download, signal).then(
        (ready) => {
          signal.removeEventListener("abort", onAbort);
          resolve(ready);
        },
        (error) => {
          signal.removeEventListener("abort", onAbort);
          reject(error);
        }
      );
    });
  }

  private static async activateReadyDebridDownload(
    download: Download,
    isCurrent: () => boolean,
    signal: AbortSignal
  ) {
    if (!isCurrent()) return;
    const current = await this.getDownload(download.shop, download.objectId);
    if (
      !isCurrent() ||
      !current?.awaitingDebrid ||
      current.debridAutoResume !== true ||
      current.uri !== download.uri
    ) {
      return;
    }
    const readyDownload: Download = {
      ...current,
      realDebridTorrentId: download.realDebridTorrentId,
      awaitingDebrid: false,
      debridAutoResume: false,
      debridQueueOnly: undefined,
      debridPreparationDeadline: undefined,
    };
    if (current.debridQueueOnly) {
      await this.queueDownload(readyDownload);
      WindowManager.sendDownloadsUpdated();
      return;
    }
    const downloads = await this.getAllDownloads();
    if (!isCurrent()) return;
    const layout = await getNormalizedDownloadLayoutState(downloads);
    if (!isCurrent()) return;
    const hasActive =
      DownloadManager.hasActiveDownload() ||
      downloads.some(isActiveLikeDownload);
    if (
      hasActive ||
      getQueuedDownloadsOrderedByLayout(downloads, layout).length > 0
    ) {
      await this.queueDownload(readyDownload);
      if (!isCurrent()) return;
      await this.activateNextQueuedDownload(undefined, {
        id: getDownloadId(readyDownload),
        isCurrent,
        signal,
      });
      WindowManager.sendDownloadsUpdated();
      return;
    }
    const activated = await this.activateDownload(
      readyDownload,
      isCurrent,
      signal
    );
    if (!activated || !isCurrent()) return;
    await removeDownloadFromLayoutState(
      readyDownload,
      await this.getAllDownloads()
    );
    WindowManager.sendDownloadsUpdated();
  }

  static async pollAwaitingDebridDownloads(now = Date.now()) {
    const downloads = await this.getAllDownloads();
    const polls = await Promise.all(
      downloads.map((download) => this.startDebridReadinessPoll(download, now))
    );
    await Promise.allSettled(
      polls.flatMap((poll) => (poll ? [poll.result] : []))
    );
  }

  private static async startDebridReadinessPoll(
    download: Download,
    now: number
  ) {
    if (
      download.status !== "paused" ||
      !download.awaitingDebrid ||
      download.debridAutoResume !== true
    ) {
      return null;
    }
    const key = getGameKey(download);
    const deadline = download.debridPreparationDeadline;
    if (!Number.isFinite(deadline) || deadline! <= now) {
      this.invalidateBackgroundStart(key);
      await this.expireDebridPreparation(download);
      return null;
    }
    if (
      !this.isOnline ||
      this.preparationControllers.has(key) ||
      now - (this.lastDebridPollAt.get(key) ?? -Infinity) <
        DEBRID_READINESS_POLL_MS
    ) {
      return null;
    }
    this.lastDebridPollAt.set(key, now);
    const preparation = this.beginPreparation(key);
    const timer = setTimeout(
      () => preparation.controller.abort(),
      Math.max(0, deadline! - now)
    );
    const poll = async () => {
      try {
        const ready = await this.waitForDebridReadiness(
          download,
          preparation.signal
        );
        clearTimeout(timer);
        if (!preparation.isCurrent()) return;
        if (!ready) {
          const current = await this.getDownload(
            download.shop,
            download.objectId
          );
          if (!preparation.isCurrent() || !current?.debridAutoResume) return;
          // Preparation can discover the cloud torrent ID before its files.
          await downloadsSublevel.put(key, {
            ...current,
            realDebridTorrentId: download.realDebridTorrentId,
          });
          return;
        }
        const activate = withDownloadActivation(() =>
          this.activateReadyDebridDownload(
            download,
            preparation.isCurrent,
            preparation.signal
          )
        );
        await activate;
      } catch (error) {
        if (!preparation.hasCurrentVersion()) return;
        if (preparation.signal.aborted) {
          await this.expireDebridPreparation(download);
          return;
        }
        if (isDebridPendingError(error, download.downloader)) return;
        await this.saveDebridPreparationError(download, preparation.isCurrent);
        logger.error("Failed to prepare pending debrid download", error);
      } finally {
        clearTimeout(timer);
        preparation.dispose();
      }
    };
    return { result: poll() };
  }

  static async resumeDownload(
    shop: GameShop,
    objectId: string,
    strategy: ResumeDownloadStrategy = "interruptActive"
  ) {
    const preparation = this.beginPreparation(levelKeys.game(shop, objectId));
    try {
      return await this.resumeDownloadWithPreparation(
        shop,
        objectId,
        strategy,
        preparation.isCurrent,
        preparation.signal
      );
    } finally {
      preparation.dispose();
    }
  }

  private static async resumeDownloadWithPreparation(
    shop: GameShop,
    objectId: string,
    strategy: ResumeDownloadStrategy,
    isCurrent: () => boolean,
    signal: AbortSignal
  ) {
    const download = await this.getDownload(shop, objectId);

    if (
      !download ||
      !["paused", "active", "error"].includes(download.status ?? "") ||
      download.progress === 1
    ) {
      return false;
    }

    if (!isCurrent()) return false;
    const resumingDownload: Download = {
      ...download,
      debridAutoResume: true,
      debridQueueOnly: undefined,
      debridPreparationDeadline: Date.now() + DEBRID_PREPARATION_WINDOW_MS,
    };
    try {
      if (!(await this.isAwaitingDebridReady(resumingDownload, signal))) {
        await this.saveAwaitingDebridDownload(resumingDownload, isCurrent);
        return false;
      }
    } catch (error) {
      if (!isCurrent()) return false;
      await this.saveDebridPreparationError(resumingDownload, isCurrent);
      throw error;
    }
    if (!isCurrent()) return false;
    const readyDownload = {
      ...resumingDownload,
      awaitingDebrid: false,
    };

    return withDownloadActivation(() =>
      this.activateResumedDownload(readyDownload, strategy, isCurrent, signal)
    );
  }

  private static async activateResumedDownload(
    readyDownload: Download,
    strategy: ResumeDownloadStrategy,
    isCurrent: () => boolean,
    signal: AbortSignal
  ) {
    if (!isCurrent()) return false;
    const downloads = await this.getAllDownloads();
    if (!isCurrent()) return false;
    const currentActiveDownload =
      downloads.find(
        (entry) =>
          isActiveLikeDownload(entry) &&
          getDownloadId(entry) !== getDownloadId(readyDownload)
      ) ?? null;

    if (currentActiveDownload && strategy === "queueIfActive") {
      await this.queueDownload(
        {
          ...readyDownload,
          debridAutoResume: false,
          debridQueueOnly: undefined,
          debridPreparationDeadline: undefined,
        },
        { toFront: true }
      );
      WindowManager.sendDownloadsUpdated();
      return true;
    }

    if (currentActiveDownload) {
      await this.pauseDownload(currentActiveDownload, {
        reason: "paused",
        startNextQueued: false,
      });
    }

    const activated = await this.activateDownload(
      readyDownload,
      isCurrent,
      signal
    );
    if (!activated) {
      if (!isCurrent()) return false;
      await this.restoreInterruptedDownload(currentActiveDownload);
      return false;
    }
    const nextDownloads = await this.getAllDownloads();
    await removeDownloadFromLayoutState(readyDownload, nextDownloads);
    WindowManager.sendDownloadsUpdated();

    return true;
  }

  static async pauseDownloadById(
    shop: GameShop,
    objectId: string,
    confirmed = false
  ) {
    const key = levelKeys.game(shop, objectId);
    if (!DownloadManager.confirmPauseDownload(key, confirmed)) return false;
    this.invalidateBackgroundStart(key);
    const download = await this.getDownload(shop, objectId);
    if (!download) return false;

    await this.pauseDownload(download, {
      reason: "paused",
      startNextQueued: true,
    });

    return true;
  }

  static async cancelDownloadById(shop: GameShop, objectId: string) {
    this.invalidateBackgroundStart(levelKeys.game(shop, objectId));
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
      awaitingDebrid: false,
      debridAutoResume: false,
      debridQueueOnly: undefined,
      debridPreparationDeadline: undefined,
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

  private static preparePausedPlacement(
    download: Download,
    confirmed: boolean
  ) {
    if (
      isActiveLikeDownload(download) &&
      !DownloadManager.confirmPauseDownload(getGameKey(download), confirmed)
    )
      return false;
    this.invalidateBackgroundStart(getGameKey(download));
    download.debridAutoResume = false;
    download.debridQueueOnly = undefined;
    download.debridPreparationDeadline = undefined;
    return true;
  }

  static moveDownloadPlacement(
    shop: GameShop,
    objectId: string,
    targetArea: "hero" | "queue" | "paused",
    targetIndex?: number,
    confirmed = false
  ) {
    const move = () =>
      this.applyDownloadPlacement(
        shop,
        objectId,
        targetArea,
        targetIndex,
        confirmed
      );
    return targetArea === "hero" ? withDownloadActivation(move) : move();
  }

  private static async applyDownloadPlacement(
    shop: GameShop,
    objectId: string,
    targetArea: "hero" | "queue" | "paused",
    targetIndex?: number,
    confirmed = false
  ) {
    const download = await this.getDownload(shop, objectId);

    if (
      !download ||
      isCompletedLikeDownload(download) ||
      download.status === "removed"
    ) {
      return false;
    }

    if (download.awaitingDebrid && targetArea !== "paused") return false;

    if (
      targetArea === "paused" &&
      !this.preparePausedPlacement(download, confirmed)
    )
      return false;

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

      const activated = await this.activateDownload(download);
      if (!activated) {
        await this.restoreInterruptedDownload(currentActiveDownload);
        return false;
      }
      const nextDownloads = await this.getAllDownloads();
      await setDownloadLayoutQueues(nextDownloads, queueIds, pausedIds);
      WindowManager.sendDownloadsUpdated();
      return true;
    }

    if (targetArea === "queue") {
      return this.moveDownloadToQueue(
        download,
        isHero,
        queueIds,
        pausedIds,
        targetIndex
      );
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

  private static async moveDownloadToQueue(
    download: Download,
    isHero: boolean,
    queueIds: string[],
    pausedIds: string[],
    targetIndex?: number
  ): Promise<boolean> {
    const downloadId = getDownloadId(download);
    if (isHero && isActiveLikeDownload(download)) {
      await DownloadManager.pauseDownload(getGameKey(download));
      WindowManager.sendToAppWindows("on-download-progress", null);
    }
    await this.setDownloadPausedState(download, { queued: true });

    const nextDownloads = await this.getAllDownloads();
    await setDownloadLayoutQueues(
      nextDownloads,
      withInsertedId(queueIds, downloadId, targetIndex),
      pausedIds
    );

    DownloadManager.clearQueueVerifyAttempt(download);

    if (isHero) {
      await this.startNextQueuedDownload(
        nextDownloads.filter((entry) => getDownloadId(entry) !== downloadId)
      );
    } else {
      WindowManager.sendDownloadsUpdated();
    }

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
