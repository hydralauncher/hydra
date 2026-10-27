import {
  configureRangeStateDirectory,
  getRangeDownloadedBytes,
  getResourceIdentityState,
  readResourceIdentity,
  saveCompletedResourceIdentity,
  readRangeState,
  savedRangeBytes,
} from "./range-download-state";
import { updateDownloadRecord } from "../download-record-updater";
import { updateGameRecord } from "@main/services/game-record-updater";
import { getEpicDownloadService } from "../epic/download";
import { epicManagedErrorCode } from "../epic/legendary-managed-runtime";
import {
  Downloader,
  DownloadError,
  FILE_EXTENSIONS_TO_EXTRACT,
  resolveArchiveOrgFile,
} from "@shared";
import { WindowManager } from "../window-manager";
import { SystemPath } from "../system-path";
import {
  publishDownloadCompleteNotification,
  publishDownloadHaltedNotification,
} from "../notifications";
import type {
  Download,
  DownloadFile,
  DownloadProgress,
  Game,
  UserPreferences,
} from "@types";
import {
  GofileApi,
  DatanodesApi,
  MediafireApi,
  PixelDrainApi,
  FuckingFastApi,
  VikingFileApi,
  RootzApi,
} from "../hosters";
import { TorrentService } from "../torrent-service";
import {
  LibtorrentPayload,
  LibtorrentStatus,
  isQueueVerifyCandidate,
  isVerifyingStatus,
} from "./types";
import { calculateETA, getDirSize } from "./helpers";
import { extractDownloadFilename } from "./download-filename";
import { RealDebridClient } from "./real-debrid";
import path from "node:path";
import fs from "node:fs";
import { setTimeout as sleep } from "node:timers/promises";
import os from "node:os";
import { logger } from "../logger";
import { db, downloadsSublevel, gamesSublevel, levelKeys } from "@main/level";
import { TorBoxClient } from "./torbox";
import { TorBoxBatchDownloader } from "./torbox-batch-downloader";
import { selectTorBoxFiles } from "./torbox-files";
import { GameFilesManager } from "../game-files-manager";
import { PremiumizeClient } from "./premiumize";
import { AllDebridClient } from "./all-debrid";
import { getDebridRootFolderName, isZipDownloadUrl } from "./debrid-files";
import { getRangeSizeForRequestBudget } from "./parallel-range-download";
import {
  DEFAULT_DOWNLOAD_USER_AGENT,
  JsHttpDownloader,
  type JsHttpDownloaderOptions,
  type JsHttpDownloaderStatus,
} from "./js-http-downloader";
import {
  clampProgress,
  getJsBatchProgress,
  isRetryableHttpStatus,
  sampleJsBatchSpeed,
} from "./js-http-downloader-helpers";
import { getDirectorySize } from "@main/events/helpers/get-directory-size";
import {
  getDownloadLayoutStateRecord,
  setDownloadLayoutQueues,
} from "../download-layout-state";
import { shouldFinalizeDownload } from "./download-completion";
import { describeErrorCause } from "@main/helpers/download-error-handler";
import {
  DISK_SPACE_CHECK_INTERVAL_MS,
  getDownloadDiskSpace,
} from "./disk-space";
import {
  QUEUE_VERIFY_MAX_ENTRIES,
  QUEUE_VERIFY_TTL_MS,
  clearVerifyAttempt,
  getQueueVerifySig,
  isVerifyAttemptFresh,
  recordVerifyAttempt,
} from "./download-queue-verify";

configureRangeStateDirectory(
  path.join(SystemPath.getPath("userData"), "DownloadRanges")
);

const PREFLIGHT_MAX_ATTEMPTS = 3;
const PREFLIGHT_RETRY_DELAY_MS = 1000;
const PREFLIGHT_TIMEOUT_MS = 15_000;
const TORRENT_START_TIMEOUT_MS = 10_000;
const SELECTIVE_TORRENT_START_TIMEOUT_MS = 60_000;
const SELECTIVE_TORRENT_METADATA_TIMEOUT_MS = 60_000;
const MIN_BATCH_COMPLETION_RATIO = 0.95;
const DEFAULT_REAL_DEBRID_CONNECTIONS = 4;
const HIGH_BANDWIDTH_PRIORITY_WEIGHT = 2;
const NORMAL_BANDWIDTH_PRIORITY_WEIGHT = 1;
const BANDWIDTH_REBALANCE_INTERVAL_MS = 1_000;
const BANDWIDTH_UNDERUSE_RATIO = 0.8;
const MIN_BANDWIDTH_ALLOCATION_BYTES_PER_SECOND = 64 * 1024;

interface JsDownloadOptions {
  url: string;
  savePath: string;
  filename?: string;
  headers?: Record<string, string>;
  allowParallelRanges?: boolean;
  parallelRangeConnections?: number;
  probeUnboundedRange?: boolean;
  totalSize?: number;
}

interface PreparedJsDownload {
  uri: string;
  resolvedAt: number;
  options: JsDownloadOptions;
}

interface JsBatchEntry {
  url?: string;
  filename: string;
  size?: number;
  isLocked?: boolean;
  fileId?: number;
  isZip?: boolean;
  resourceId?: string;
  preparedLink?: { url: string; resolvedAt: number };
  fileIndex?: number;
  sourcePath?: string;
  chunks?: number;
}

interface JsBatchState {
  generation?: number;
  provider: "allDebrid" | "torBox" | "realDebrid";
  downloadId: string;
  savePath: string;
  entries: JsBatchEntry[];
  torrentId?: number;
  sourceUri?: string;
  rootFolderName?: string;
  currentIndex: number;
  activeIndex: number;
  completedBytes: number;
  totalBytes: number;
  lastSpeedUpdate: number;
  bytesAtLastSpeedUpdate: number | null;
  batchSpeed: number;
}

interface DownloadSession {
  downloadId: string;
  downloader: JsHttpDownloader | TorBoxBatchDownloader | null;
  epic: boolean;
  torrent: boolean;
  batch: JsBatchState | null;
  preparationController: AbortController;
  generation: number;
  isPreparing: boolean;
}

interface JsDownloadStatusSnapshot {
  progress: number;
  bytesDownloaded: number;
  fileSize: number;
  folderName: string | null;
  downloadSpeed: number;
  files: Download["files"];
  batchFilesTotal?: number;
  batchFilesDownloaded?: number;
}

type PendingBandwidthAllocation = {
  weight: number;
  demand: number;
  allocation: number;
};

function allocateBandwidth(
  pending: PendingBandwidthAllocation[],
  limit: number
) {
  let remaining = limit;
  let eligible = [...pending];
  while (eligible.length && remaining > 0) {
    const totalWeight = eligible.reduce((sum, entry) => sum + entry.weight, 0);
    const constrained = eligible.filter(
      (entry) => entry.demand <= (remaining * entry.weight) / totalWeight
    );
    if (!constrained.length) {
      for (const entry of eligible) {
        entry.allocation += Math.floor(
          (remaining * entry.weight) / totalWeight
        );
      }
      break;
    }
    for (const entry of constrained) {
      entry.allocation += entry.demand;
      remaining -= entry.demand;
    }
    eligible = eligible.filter((entry) => !constrained.includes(entry));
  }
}

const TORBOX_MAX_PARALLEL_RANGES = 256;
const REAL_DEBRID_MAX_CONNECTIONS = 8;

function realDebridConnections(chunks: number | undefined): number {
  if (!Number.isInteger(chunks) || !chunks || chunks < 1)
    return DEFAULT_REAL_DEBRID_CONNECTIONS;
  return Math.min(chunks, REAL_DEBRID_MAX_CONNECTIONS);
}

export class DownloadManager {
  private static readonly orphanedDownloadCandidates = new Map<
    string,
    DownloadSession
  >();
  private static readonly lastDiskSpaceChecks = new Map<string, number>();
  private static readonly progressById = new Map<string, DownloadProgress>();
  private static readonly epicCompletions = new Set<string>();
  private static maxDownloadSpeedBytesPerSecond: number | null = null;
  private static readonly observedDownloadSpeeds = new Map<string, number>();
  private static readonly bandwidthAllocations = new Map<
    string,
    number | null
  >();
  private static bandwidthRebalance: Promise<void> = Promise.resolve();
  private static lastBandwidthRebalanceAt = 0;
  private static readonly sessions = new Map<string, DownloadSession>();
  private static readonly sessionGenerations = new Map<string, number>();
  private static readonly preparedRealDebridDownloads = new Map<
    string,
    {
      uri: string;
      selection: string;
      resolvedAt: number;
      resolved: Awaited<
        ReturnType<typeof RealDebridClient.getDownloadEntriesWithTorrent>
      >;
    }
  >();
  private static queueHeldForDiskSpace = false;
  private static lastQueueRetry = 0;
  private static readonly queueVerifyAttempts = new Map<
    string,
    { at: number; sig: string }
  >();
  private static readonly preparedJsDownloads = new Map<
    string,
    PreparedJsDownload
  >();
  private static readonly PREPARED_JS_DOWNLOAD_TTL_MS = 120_000;

  // Runtime snapshots must not overwrite user-owned bandwidth priority.
  private static persistDownloadRecord(
    downloadId: string,
    snapshot: Download,
    isCurrent: () => boolean = () => true
  ) {
    return updateDownloadRecord(downloadId, (current) =>
      isCurrent()
        ? { ...snapshot, bandwidthPriority: current.bandwidthPriority }
        : undefined
    );
  }

  private static createSession(
    downloadId: string,
    preparationController: AbortController
  ): DownloadSession {
    const generation = (this.sessionGenerations.get(downloadId) ?? 0) + 1;
    this.sessionGenerations.set(downloadId, generation);
    const session: DownloadSession = {
      downloadId,
      downloader: null,
      epic: false,
      torrent: false,
      batch: null,
      preparationController,
      generation,
      isPreparing: true,
    };

    this.sessions.set(downloadId, session);
    return session;
  }

  private static getSession(downloadId: string): DownloadSession | null {
    return this.sessions.get(downloadId) ?? null;
  }

  private static isSessionCurrent(
    downloadId: string,
    session: DownloadSession | null
  ) {
    return (
      session !== null &&
      this.sessions.get(downloadId) === session &&
      !session.preparationController.signal.aborted
    );
  }

  private static clearSession(
    downloadId: string,
    session?: DownloadSession | null
  ) {
    if (!session || this.sessions.get(downloadId) === session) {
      this.sessions.delete(downloadId);
      this.orphanedDownloadCandidates.delete(downloadId);
      this.lastDiskSpaceChecks.delete(downloadId);
      this.progressById.delete(downloadId);
      this.updateTaskbarProgress();
      this.observedDownloadSpeeds.delete(downloadId);
      this.bandwidthAllocations.delete(downloadId);
      this.scheduleBandwidthRebalance();
    }
  }

  /** Number of game transfers currently owned by the download manager. */
  public static getActiveDownloadCount(): number {
    return this.sessions.size;
  }

  /** IDs are exposed for status polling and the future concurrent scheduler. */
  public static getActiveDownloadIds(): string[] {
    return [...this.sessions.keys()];
  }
  public static hasActiveDownload() {
    return this.sessions.size > 0;
  }
  public static hasRunningDownload(downloadId: string): boolean {
    const session = this.sessions.get(downloadId);
    return (
      !!session &&
      !session.isPreparing &&
      (session.downloader !== null || session.epic || session.torrent)
    );
  }
  public static get isJsDownloadActive(): boolean {
    return [...this.sessions.values()].some(
      (session) => session.downloader !== null
    );
  }

  public static notifyReconnecting(value: boolean): void {
    for (const session of this.sessions.values()) {
      session.downloader?.setReconnecting(value);
    }
  }

  public static reconnectActiveDownload(): void {
    for (const session of this.sessions.values()) {
      session.downloader?.reconnect();
    }
  }

  public static isActiveDownloadReconnecting(): boolean {
    return [...this.sessions.values()].some(
      (session) =>
        session.downloader?.getDownloadStatus()?.isReconnecting === true
    );
  }

  private static extractFilename(
    url: string,
    originalUrl?: string
  ): string | undefined {
    return extractDownloadFilename(url, originalUrl);
  }

  private static sanitizeFilename(filename: string): string {
    return filename.replaceAll(/[<>:"/\\|?*]/g, "_");
  }

  private static sanitizeRelativePath(pathValue: string): string {
    return pathValue
      .split(/[\\/]+/)
      .filter((segment) => segment !== "." && segment !== "..")
      .map((segment) => this.sanitizeFilename(segment))
      .filter(Boolean)
      .join("/");
  }

  private static assertSafeBatchPath(savePath: string, filename: string) {
    const root = path.resolve(savePath);
    const target = path.resolve(root, filename);
    const relative = path.relative(root, target);
    if (
      !relative ||
      relative === ".." ||
      relative.startsWith(".." + path.sep) ||
      path.isAbsolute(relative)
    ) {
      throw new Error("The download file path is outside the selected folder.");
    }

    for (
      let parent = target;
      path.relative(root, parent) !== "";
      parent = path.dirname(parent)
    ) {
      try {
        if (fs.lstatSync(parent).isSymbolicLink()) {
          throw new Error("The download file path contains a symbolic link.");
        }
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      }
    }
  }

  private static resolveFilename(
    resumingFilename: string | undefined,
    originalUrl: string,
    downloadUrl: string
  ): string | undefined {
    if (resumingFilename) return resumingFilename;

    const extracted =
      this.extractFilename(originalUrl, downloadUrl) ||
      this.extractFilename(downloadUrl);

    return extracted ? this.sanitizeFilename(extracted) : undefined;
  }

  private static buildDownloadOptions(
    url: string,
    savePath: string,
    filename: string | undefined,
    headers?: Record<string, string>
  ) {
    return {
      url,
      savePath,
      filename,
      headers,
    };
  }

  private static parseGofileUri(uri: string) {
    let normalizedUri = uri.trim();

    if (
      !normalizedUri.startsWith("http://") &&
      !normalizedUri.startsWith("https://")
    ) {
      normalizedUri = `https://${normalizedUri}`;
    }

    try {
      const parsed = new URL(normalizedUri);
      const id = parsed.pathname.split("/").filter(Boolean).pop() || "";
      const password = parsed.searchParams.get("password") || undefined;

      return {
        id,
        password,
      };
    } catch {
      const id =
        normalizedUri.split("?")[0].split("/").filter(Boolean).pop() || "";
      return {
        id,
        password: undefined,
      };
    }
  }

  private static logResolvedUrl(url: string): void {
    let sanitizedUrl = url;

    try {
      const parsedUrl = new URL(url);
      sanitizedUrl = `${parsedUrl.origin}${parsedUrl.pathname}`;
    } catch {
      sanitizedUrl = url.replace(/[?#].*$/, "");
    }

    logger.log(`[DownloadManager] Resolved URL: ${sanitizedUrl}`);
  }

  private static createDownloadPayload(
    directUrl: string,
    originalUrl: string,
    downloadId: string,
    savePath: string
  ) {
    const filename =
      this.extractFilename(originalUrl, directUrl) ||
      this.extractFilename(directUrl);
    const sanitizedFilename = filename
      ? this.sanitizeFilename(filename)
      : undefined;

    if (sanitizedFilename) {
      logger.log(`[DownloadManager] Using filename: ${sanitizedFilename}`);
    } else {
      logger.log(
        `[DownloadManager] No filename extracted, downloader will use default`
      );
    }

    return {
      action: "start" as const,
      game_id: downloadId,
      url: directUrl,
      save_path: savePath,
      out: sanitizedFilename,
      allow_multiple_connections: true,
    };
  }

  private static isHttpDownloader(downloader: Downloader): boolean {
    return downloader !== Downloader.Torrent && downloader !== Downloader.Epic;
  }

  private static normalizeDownloadSpeedLimit(
    value?: number | null
  ): number | null {
    if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) {
      return null;
    }

    return Math.floor(value);
  }

  private static async getPersistedDownloadSpeedLimit() {
    const userPreferences = await db.get<string, UserPreferences | null>(
      levelKeys.userPreferences,
      { valueEncoding: "json" }
    );

    return this.normalizeDownloadSpeedLimit(
      userPreferences?.maxDownloadSpeedBytesPerSecond
    );
  }

  public static async applyDownloadSpeedLimit(
    value?: number | null
  ): Promise<void> {
    const normalizedLimit =
      value === undefined
        ? await this.getPersistedDownloadSpeedLimit()
        : this.normalizeDownloadSpeedLimit(value);

    this.maxDownloadSpeedBytesPerSecond = normalizedLimit;

    await TorrentService.call("action", {
      action: "set_download_limit",
      max_download_speed_bytes_per_second: normalizedLimit,
    }).catch((error) => {
      logger.error(
        "[DownloadManager] Failed to update torrent download speed limit:",
        error
      );
    });
    await this.rebalanceBandwidth(true);
  }

  /**
   * Give every controllable active download an equal share by default. A user
   * priority doubles that download's weight; unused allocations are handed
   * back to peers that are still able to use them. Epic is deliberately not a
   * participant because Legendary exposes no runtime rate-limit control.
   */
  public static async rebalanceBandwidth(force = false): Promise<void> {
    const now = Date.now();
    if (
      !force &&
      now - this.lastBandwidthRebalanceAt < BANDWIDTH_REBALANCE_INTERVAL_MS
    )
      return;
    this.lastBandwidthRebalanceAt = now;

    const limit = this.maxDownloadSpeedBytesPerSecond;
    const sessions = [...this.sessions.values()].filter(
      (session) =>
        !session.epic &&
        !session.isPreparing &&
        (session.torrent || session.downloader !== null)
    );

    const downloads = await Promise.all(
      sessions.map(async (session) => ({
        session,
        download: await downloadsSublevel.get(session.downloadId),
      }))
    );
    const candidates = downloads.filter(
      (entry): entry is { session: DownloadSession; download: Download } =>
        entry.download !== undefined
    );

    const pending = candidates.map(({ session, download }) => {
      const previousCap = this.bandwidthAllocations.get(session.downloadId);
      const observed = this.observedDownloadSpeeds.get(session.downloadId) ?? 0;
      const demand =
        typeof previousCap === "number" &&
        observed < previousCap * BANDWIDTH_UNDERUSE_RATIO
          ? Math.max(
              MIN_BANDWIDTH_ALLOCATION_BYTES_PER_SECOND,
              Math.ceil(observed / BANDWIDTH_UNDERUSE_RATIO)
            )
          : Number.POSITIVE_INFINITY;
      return {
        session,
        weight:
          download.bandwidthPriority === "high"
            ? HIGH_BANDWIDTH_PRIORITY_WEIGHT
            : NORMAL_BANDWIDTH_PRIORITY_WEIGHT,
        demand,
        allocation: 0,
      };
    });

    if (limit !== null) allocateBandwidth(pending, limit);

    await Promise.all(
      pending.map(async (entry) => {
        const nextLimit = limit === null ? null : entry.allocation;
        const previous = this.bandwidthAllocations.get(
          entry.session.downloadId
        );
        if (
          !this.isSessionCurrent(entry.session.downloadId, entry.session) ||
          previous === nextLimit
        )
          return;
        if (entry.session.torrent) {
          await TorrentService.call("action", {
            action: "set_game_download_limit",
            game_id: entry.session.downloadId,
            max_download_speed_bytes_per_second: nextLimit ?? 0,
          });
        } else {
          entry.session.downloader?.setMaxDownloadSpeedBytesPerSecond(
            nextLimit
          );
        }
        if (this.isSessionCurrent(entry.session.downloadId, entry.session))
          this.bandwidthAllocations.set(entry.session.downloadId, nextLimit);
      })
    );
  }

  private static scheduleBandwidthRebalance(force = false) {
    this.bandwidthRebalance = this.bandwidthRebalance
      .catch(() => undefined)
      .then(() => this.rebalanceBandwidth(force))
      .catch((error) =>
        logger.error(
          "[DownloadManager] Failed to rebalance download bandwidth",
          error
        )
      );
  }

  private static async getPersistedNetworkInterface() {
    const userPreferences = await db.get<string, UserPreferences | null>(
      levelKeys.userPreferences,
      { valueEncoding: "json" }
    );

    return userPreferences?.torrentNetworkInterface ?? null;
  }

  private static resolveNetworkInterfaceBinding(name: string | null): string {
    if (!name) return "";

    const addresses = os.networkInterfaces()[name] ?? [];
    const usable = addresses.filter(
      (address) =>
        !address.internal &&
        !(
          address.family === "IPv6" &&
          address.address.toLowerCase().startsWith("fe80")
        )
    );

    if (usable.length === 0) return name;

    return usable.map((address) => address.address).join(",");
  }

  public static async applyNetworkInterface(
    value?: string | null
  ): Promise<void> {
    const networkInterface =
      value ?? (await this.getPersistedNetworkInterface());

    await TorrentService.call("action", {
      action: "set_network_interface",
      interface: this.resolveNetworkInterfaceBinding(networkInterface),
    }).catch((error) => {
      logger.error(
        "[DownloadManager] Failed to update torrent network interface:",
        error
      );
    });
  }

  public static async initializeTorrentService(
    download?: Download,
    downloadsToSeed?: Download[]
  ) {
    await TorrentService.initialize();

    await this.applyNetworkInterface();

    if (downloadsToSeed?.length) {
      for (const seedDownload of downloadsToSeed) {
        await this.resumeSeeding(seedDownload).catch((error) => {
          logger.error("[DownloadManager] Failed to resume seeding", error);
        });
      }
    }

    if (download) {
      await this.startDownload(download).catch((error) => {
        logger.error("[DownloadManager] Failed to resume download", error);
      });
    }

    await this.applyDownloadSpeedLimit();
  }

  private static async getDownloadStatusFromJs(
    sessionId: string
  ): Promise<DownloadProgress | null> {
    if (!sessionId) return null;

    const downloadId = sessionId;
    const session = this.getSession(downloadId);
    if (!session) return null;
    const generation = session.generation;
    const downloader = session?.downloader;
    const isCurrent = () =>
      this.isJsDownloadCurrent(downloadId, session, generation, downloader);

    // Return a "preparing" status while fetching download options
    if (session.isPreparing)
      return this.getPreparingJsDownloadStatus(downloadId, isCurrent);

    if (!downloader) return null;

    const status = downloader.getDownloadStatus();
    if (!status) return null;

    try {
      const download = await downloadsSublevel.get(downloadId);
      if (!download || !isCurrent()) return null;

      const snapshot: JsDownloadStatusSnapshot = {
        progress: status.progress,
        bytesDownloaded: status.bytesDownloaded,
        fileSize: status.fileSize,
        folderName: status.folderName,
        downloadSpeed: status.downloadSpeed,
        files:
          downloader instanceof TorBoxBatchDownloader
            ? downloader.getFiles()
            : download.files,
      };
      const batch = session?.batch;
      if (batch?.downloadId === downloadId)
        this.applyBatchProgress(batch, download, status, snapshot, session);

      snapshot.progress = clampProgress(snapshot.progress);

      const effectiveFileSize =
        snapshot.fileSize > 0 ? snapshot.fileSize : download.fileSize;

      const updatedDownload = await this.persistJsDownloadStatus(
        downloadId,
        status,
        snapshot,
        effectiveFileSize,
        isCurrent
      );
      if (!updatedDownload) return null;

      if (!isCurrent()) return null;

      return {
        numPeers: 0,
        numSeeds: 0,
        downloadSpeed: snapshot.downloadSpeed,
        timeRemaining: calculateETA(
          effectiveFileSize ?? 0,
          snapshot.bytesDownloaded,
          snapshot.downloadSpeed
        ),
        isDownloadingMetadata: false,
        isCheckingFiles: false,
        isReconnecting: status.isReconnecting,
        isRecovering: status.isRecovering,
        recoveryProgress: status.recoveryProgress,
        progress: snapshot.progress,
        gameId: downloadId,
        download: updatedDownload,
        batchFilesTotal: snapshot.batchFilesTotal,
        batchFilesDownloaded: snapshot.batchFilesDownloaded,
      };
    } catch (err) {
      logger.error("[DownloadManager] Error getting JS download status:", err);
      return null;
    }
  }

  private static async persistJsDownloadStatus(
    downloadId: string,
    status: JsHttpDownloaderStatus,
    snapshot: JsDownloadStatusSnapshot,
    effectiveFileSize: number | null,
    isCurrent: () => boolean
  ): Promise<Download | null> {
    // The serialized writer preserves user-owned metadata at commit time.
    const latestDownload = await downloadsSublevel.get(downloadId);
    if (!latestDownload || !isCurrent()) return null;

    let updatedDownload: Download = {
      ...latestDownload,
      files: snapshot.files,
      bytesDownloaded: snapshot.bytesDownloaded,
      fileSize: effectiveFileSize,
      progress: snapshot.progress,
      folderName: snapshot.folderName,
      status: status.status === "complete" ? "complete" : "active",
    };

    if (status.status === "active" || status.status === "complete") {
      const saved = await this.persistDownloadRecord(
        downloadId,
        updatedDownload,
        isCurrent
      );
      if (!saved) return null;
      updatedDownload = saved;
    }
    return updatedDownload;
  }

  private static isJsDownloadCurrent(
    downloadId: string,
    session: DownloadSession | null,
    generation: number,
    downloader: DownloadSession["downloader"]
  ) {
    if (session) {
      return (
        this.sessions.get(downloadId) === session &&
        session.generation === generation &&
        session.downloader === downloader &&
        !session.preparationController.signal.aborted
      );
    }
    return false;
  }

  private static async getPreparingJsDownloadStatus(
    downloadId: string,
    isCurrent: () => boolean
  ): Promise<DownloadProgress | null> {
    try {
      const download = await downloadsSublevel.get(downloadId);
      if (!download || !isCurrent()) return null;
      return {
        numPeers: 0,
        numSeeds: 0,
        downloadSpeed: 0,
        timeRemaining: -1,
        isDownloadingMetadata: true,
        isCheckingFiles: false,
        progress: 0,
        gameId: downloadId,
        download,
      };
    } catch {
      return null;
    }
  }

  private static applyBatchProgress(
    batch: JsBatchState,
    download: Download,
    status: JsHttpDownloaderStatus,
    snapshot: JsDownloadStatusSnapshot,
    session: DownloadSession | null
  ) {
    const batchDone =
      batch.currentIndex >= batch.entries.length &&
      status.status === "complete";
    snapshot.batchFilesTotal = batch.entries.length;

    if (batch.provider === "torBox" || batch.provider === "realDebrid") {
      snapshot.files = batch.entries.map((entry, index) => {
        const previous = download.files?.find(
          (file) => file.index === (entry.fileId ?? entry.fileIndex)
        );
        const completed = index < batch.currentIndex;
        let entryBytes = previous?.bytesDownloaded ?? 0;
        if (completed) entryBytes = entry.size ?? 0;
        else if (index === batch.activeIndex)
          entryBytes = status.bytesDownloaded;
        return {
          index: (entry.fileId ?? entry.fileIndex)!,
          path: entry.filename,
          size: entry.size ?? 0,
          bytesDownloaded: entryBytes,
          completed,
        };
      });
    }

    if (batchDone) {
      if (session) session.batch = null;
      snapshot.progress = 1;
      snapshot.bytesDownloaded = batch.completedBytes;
      snapshot.fileSize = batch.totalBytes;
      snapshot.folderName = batch.rootFolderName ?? snapshot.folderName;
      snapshot.batchFilesDownloaded = snapshot.batchFilesTotal;
      return;
    }

    if (status.status === "complete") status.status = "active";
    const batchProgress = getJsBatchProgress({
      currentIndex: batch.currentIndex,
      activeIndex: batch.activeIndex,
      completedBytes: batch.completedBytes,
      totalBytes: batch.totalBytes,
      entryCount: batch.entries.length,
      fileBytes: status.bytesDownloaded,
      fileProgress: status.progress,
    });
    snapshot.progress = batchProgress.progress;
    snapshot.bytesDownloaded =
      batch.completedBytes + batchProgress.currentBytes;
    snapshot.fileSize = batch.totalBytes || snapshot.fileSize;
    snapshot.folderName =
      batch.rootFolderName ??
      batch.entries[batch.currentIndex]?.filename ??
      snapshot.folderName;
    snapshot.batchFilesDownloaded = batch.currentIndex;

    const speedSample = sampleJsBatchSpeed(
      batch,
      snapshot.bytesDownloaded,
      status.isRecovering ? 0 : status.downloadSpeed,
      Date.now()
    );
    batch.lastSpeedUpdate = speedSample.lastSpeedUpdate;
    batch.bytesAtLastSpeedUpdate = speedSample.bytesAtLastSpeedUpdate;
    batch.batchSpeed = speedSample.batchSpeed;
    snapshot.downloadSpeed = batch.batchSpeed;
  }

  private static async getDownloadStatusFromRpc(
    sessionId: string
  ): Promise<DownloadProgress | null> {
    const session = sessionId ? this.getSession(sessionId) : null;
    let response: { data: LibtorrentPayload | null };

    try {
      response = await TorrentService.call<LibtorrentPayload | null>("status", {
        ...(sessionId ? { game_id: sessionId } : {}),
      });
    } catch (error) {
      logger.error("[DownloadManager] Torrent status poll failed", error);
      return null;
    }

    if (response.data === null || !sessionId) return null;
    const downloadId = sessionId;
    if (!this.isSessionCurrent(downloadId, session)) return null;

    try {
      const {
        progress,
        numPeers,
        numSeeds,
        downloadSpeed,
        bytesDownloaded,
        fileSize,
        folderName,
        status,
      } = response.data;

      const isDownloadingMetadata =
        status === LibtorrentStatus.DownloadingMetadata;
      const isCheckingFiles = isVerifyingStatus(status);

      const download = await downloadsSublevel.get(downloadId);

      if (!this.isSessionCurrent(downloadId, session)) return null;

      let updatedDownload = download;

      if (!isDownloadingMetadata && !isCheckingFiles) {
        if (!download) return null;

        const effectiveFileSize = this.resolveRpcFileSize(fileSize, download);

        updatedDownload = {
          ...download,
          bytesDownloaded,
          fileSize: effectiveFileSize,
          progress,
          folderName,
          status: "active",
        };

        updatedDownload = await this.persistDownloadRecord(
          downloadId,
          updatedDownload,
          () => this.isSessionCurrent(downloadId, session)
        );
        if (!updatedDownload) return null;
      }

      return {
        numPeers,
        numSeeds,
        downloadSpeed,
        timeRemaining: calculateETA(
          download ? this.resolveRpcFileSize(fileSize, download) : fileSize,
          bytesDownloaded,
          downloadSpeed
        ),
        isDownloadingMetadata,
        isCheckingFiles,
        progress,
        gameId: downloadId,
        download: updatedDownload,
      } as DownloadProgress;
    } catch {
      return null;
    }
  }

  private static resolveRpcFileSize(fileSize: number, download: Download) {
    return fileSize > 0
      ? fileSize
      : (download.selectedFilesSize ?? download.fileSize ?? 0);
  }

  private static async getDownloadStatusFromEpic(
    downloadId: string,
    session: DownloadSession
  ): Promise<DownloadProgress | null> {
    if (
      this.sessions.get(downloadId) !== session ||
      !session.epic ||
      session.preparationController.signal.aborted
    )
      return null;
    const download = await downloadsSublevel.get(downloadId);
    if (this.sessions.get(downloadId) !== session || !download) return null;
    const status = getEpicDownloadService().progress(download);
    if (!status) {
      if (!session.isPreparing) return null;
      return {
        download,
        gameId: downloadId,
        progress: download.progress,
        downloadSpeed: 0,
        timeRemaining: -1,
        numPeers: 0,
        numSeeds: 0,
        isDownloadingMetadata: true,
        isCheckingFiles: false,
      };
    }
    if (this.sessions.get(downloadId) !== session) return null;
    const saved = await this.persistDownloadRecord(
      downloadId,
      status.download,
      () => this.isSessionCurrent(downloadId, session)
    );
    if (!saved) return null;
    status.download = saved;
    return this.sessions.get(downloadId) === session ? status : null;
  }

  private static async cancelOrphanedDownload(
    downloadKey: string,
    session: DownloadSession
  ) {
    if (!this.isSessionCurrent(downloadKey, session)) return;
    if (this.orphanedDownloadCandidates.get(downloadKey) !== session) {
      this.orphanedDownloadCandidates.set(downloadKey, session);
      return;
    }
    logger.warn("Cancelling orphaned download", downloadKey);
    await this.cancelDownload(downloadKey);
    await this.processNextQueuedDownload();
  }

  private static async processDownloadStatus(
    status: DownloadProgress,
    generation: number,
    session: DownloadSession
  ) {
    const { gameId, progress } = status;
    const [download, game] = await Promise.all([
      downloadsSublevel.get(gameId),
      gamesSublevel.get(gameId),
    ]);

    const isCurrent = () =>
      this.sessions.get(gameId) === session &&
      session.generation === generation &&
      !session.preparationController.signal.aborted;

    if (!download || !game || !isCurrent()) return;

    if (session && !session.epic) {
      this.observedDownloadSpeeds.set(
        gameId,
        Math.max(0, status.downloadSpeed ?? 0)
      );
      this.scheduleBandwidthRebalance();
    }

    if (!status.isCheckingFiles && !status.isDownloadingMetadata) {
      const live = status.download
        ? {
            bytesDownloaded: status.download.bytesDownloaded,
            fileSize: status.download.fileSize,
          }
        : undefined;

      if (await this.haltDownloadIfStorageIsFull(download, game, gameId, live))
        return;
    }

    if (!isCurrent()) return;

    this.sendProgressUpdate(progress, status, game);

    if (
      shouldFinalizeDownload({
        usingJsDownloader: session.downloader !== null,
        usingEpicDownloader: session.epic,
        isCheckingFiles: status.isCheckingFiles,
        isDownloadingMetadata: status.isDownloadingMetadata,
        progress,
        downloadStatus: download.status,
      })
    ) {
      await this.handleDownloadCompletion(download, game, gameId);
    }
  }

  public static async watchDownloads() {
    if (this.queueHeldForDiskSpace) await this.retryQueueHeldForDiskSpace();
    const sessionEntries = [...this.sessions.entries()];
    await Promise.all(
      sessionEntries.map(async ([downloadId, session]) => {
        const download = await downloadsSublevel.get(downloadId);
        if (!this.isSessionCurrent(downloadId, session)) return;
        if (!download) {
          await this.cancelOrphanedDownload(downloadId, session);
          return;
        }
        this.orphanedDownloadCandidates.delete(downloadId);
        const sessionStatus = await this.getSessionDownloadStatus(
          downloadId,
          session
        );
        if (!sessionStatus) return;
        await this.processDownloadStatus(
          sessionStatus,
          session.generation,
          session
        );
      })
    );
  }

  private static getSessionDownloadStatus(
    downloadId: string,
    session: DownloadSession
  ) {
    if (session.epic)
      return this.getDownloadStatusFromEpic(downloadId, session);
    if (session.torrent) return this.getDownloadStatusFromRpc(downloadId);
    return this.getDownloadStatusFromJs(downloadId);
  }

  private static async retryQueueHeldForDiskSpace() {
    const now = Date.now();

    if (now - this.lastQueueRetry < DISK_SPACE_CHECK_INTERVAL_MS) return;

    this.lastQueueRetry = now;

    await this.processNextQueuedDownload();
  }

  private static async haltDownloadIfStorageIsFull(
    download: Download,
    game: Game,
    downloadKey: string,
    live?: { bytesDownloaded?: number | null; fileSize?: number | null }
  ) {
    if (download.progress >= 1) return false;

    const now = Date.now();

    if (
      this.lastDiskSpaceChecks.has(downloadKey) &&
      now - this.lastDiskSpaceChecks.get(downloadKey)! <
        DISK_SPACE_CHECK_INTERVAL_MS
    ) {
      return false;
    }

    this.lastDiskSpaceChecks.set(downloadKey, now);

    const diskSpace = await getDownloadDiskSpace(download, live);

    if (!diskSpace) {
      logger.error(
        `[DownloadManager] Failed to read free space for ${download.downloadPath}`
      );
      return false;
    }

    if (diskSpace.hasEnoughSpace) return false;

    logger.warn(
      `[DownloadManager] Halting ${downloadKey}: ${download.downloadPath} has ${diskSpace.freeBytes} bytes free, ${diskSpace.requiredBytes} needed`
    );

    this.lastDiskSpaceChecks.delete(downloadKey);

    await this.pauseDownload(downloadKey);
    WindowManager.sendToAppWindows("on-download-progress", null);

    await this.persistDownloadRecord(downloadKey, {
      ...download,
      status: "error",
      queued: false,
      pinnedToHero: false,
      extracting: false,
    });

    const downloads = await downloadsSublevel.values().all();
    const layoutState = await getDownloadLayoutStateRecord();
    await setDownloadLayoutQueues(
      downloads,
      layoutState.queueOrder.filter((id) => id !== downloadKey),
      [
        downloadKey,
        ...layoutState.pausedOrder.filter((id) => id !== downloadKey),
      ]
    );

    WindowManager.sendDownloadsUpdated();
    WindowManager.sendToAppWindows("on-download-halted", game.title);

    await publishDownloadHaltedNotification(game).catch((error) => {
      logger.error(
        "[DownloadManager] Failed to publish download halted notification",
        error
      );
    });

    await this.processNextQueuedDownload();

    return true;
  }

  private static updateTaskbarProgress() {
    const packets = [...this.progressById.values()];
    const total = packets.reduce(
      (sum, packet) => sum + (packet.download?.fileSize ?? 0),
      0
    );
    const progress =
      total > 0
        ? packets.reduce(
            (sum, packet) =>
              sum + packet.progress * (packet.download?.fileSize ?? 0),
            0
          ) / total
        : packets.reduce((sum, packet) => sum + packet.progress, 0) /
          packets.length;
    WindowManager.mainWindow?.setProgressBar(
      packets.length ? Math.min(1, Math.max(0, progress)) : -1
    );
  }

  private static sendProgressUpdate(
    progress: number,
    status: DownloadProgress,
    game: Game
  ) {
    if (progress < 1) this.progressById.set(status.gameId, status);
    else this.progressById.delete(status.gameId);
    this.updateTaskbarProgress();

    WindowManager.sendToAppWindows(
      "on-download-progress",
      structuredClone({ ...status, game })
    );
  }

  private static async handleDownloadCompletion(
    download: Download,
    game: Game,
    gameId: string
  ) {
    if (download.downloader === Downloader.Epic) {
      const session = this.getSession(gameId);
      if (
        !session?.epic ||
        session.preparationController.signal.aborted ||
        this.epicCompletions.has(gameId)
      )
        return;
      this.epicCompletions.add(gameId);
      try {
        // The adapter verified installed.json, prerequisites and executable before completion.
        await this.updateDownloadStatus(download, gameId, false);
        await publishDownloadCompleteNotification(game).catch((error) =>
          logger.error(
            "[DownloadManager] Failed to publish Epic completion",
            error
          )
        );
        await this.processNextQueuedDownload();
      } finally {
        this.epicCompletions.delete(gameId);
      }
      return;
    }
    publishDownloadCompleteNotification(game);

    const userPreferences = await db.get<string, UserPreferences | null>(
      levelKeys.userPreferences,
      { valueEncoding: "json" }
    );

    const shouldSeed = await this.updateDownloadStatus(
      download,
      gameId,
      userPreferences?.seedAfterDownloadComplete
    );

    // Calculate installer size in background
    if (download.folderName) {
      const installerPath = path.join(
        download.downloadPath,
        download.folderName
      );

      getDirectorySize(installerPath).then(async (installerSizeInBytes) => {
        const currentGame = await gamesSublevel.get(gameId);
        if (!currentGame) return;

        await updateGameRecord(gameId, {
          installerSizeInBytes,
        });
      });
    }

    if (download.automaticallyExtract) {
      const shouldPauseSeedingForExtraction =
        shouldSeed && download.downloader === Downloader.Torrent;

      if (shouldPauseSeedingForExtraction) {
        await this.cancelDownload(gameId);

        void this.handleExtraction(download, game).finally(() => {
          this.resumeSeeding(download).catch((error) => {
            logger.error(
              "[DownloadManager] Failed to resume seeding after extraction",
              error
            );
          });
        });
      } else {
        void this.handleExtraction(download, game);
      }
    } else {
      const gameFilesManager = new GameFilesManager(game.shop, game.objectId);
      gameFilesManager.searchAndBindExecutable();
      void gameFilesManager.autoLinkClassicsDiscs();
    }

    await this.processNextQueuedDownload();
  }

  private static async updateDownloadStatus(
    download: Download,
    gameId: string,
    shouldSeed?: boolean
  ): Promise<boolean> {
    const shouldExtract = download.automaticallyExtract;
    const isSelectiveTorrent =
      download.downloader === Downloader.Torrent &&
      Array.isArray(download.fileIndices) &&
      download.fileIndices.length > 0;

    if (
      shouldSeed &&
      download.downloader === Downloader.Torrent &&
      !isSelectiveTorrent
    ) {
      await this.persistDownloadRecord(gameId, {
        ...download,
        status: "seeding",
        shouldSeed: true,
        queued: false,
        pinnedToHero: false,
        extracting: shouldExtract,
      });
      WindowManager.sendDownloadsUpdated();

      // Keep the native handle seeding, but release its transfer slot and stop
      // polling it as an active download.
      this.clearSession(gameId, this.getSession(gameId));
      return true;
    } else {
      await this.persistDownloadRecord(gameId, {
        ...download,
        status: "complete",
        shouldSeed: false,
        queued: false,
        pinnedToHero: false,
        extracting: shouldExtract,
      });
      WindowManager.sendDownloadsUpdated();
      await this.cancelDownload(gameId);

      return false;
    }
  }

  private static async handleExtraction(download: Download, game: Game) {
    const gameFilesManager = new GameFilesManager(game.shop, game.objectId);
    const extractionPath = download.folderName
      ? path.join(download.downloadPath, download.folderName)
      : null;

    if (!extractionPath || !fs.existsSync(extractionPath)) {
      await gameFilesManager
        .failMissingExtractionSource(extractionPath ?? undefined)
        .catch((error) => {
          logger.error(
            "[DownloadManager] Failed to persist extraction failure state",
            error
          );
        });
      return;
    }

    const extractionStats = fs.statSync(extractionPath);

    if (
      extractionStats.isFile() &&
      FILE_EXTENSIONS_TO_EXTRACT.some((ext) =>
        download.folderName?.toLowerCase().endsWith(ext)
      )
    ) {
      await gameFilesManager.extractDownloadedFile().catch((error) => {
        logger.error(
          "[DownloadManager] Failed to extract downloaded file",
          error
        );
        return gameFilesManager.failExtraction(error).catch((failError) => {
          logger.error(
            "[DownloadManager] Failed to persist extraction failure state",
            failError
          );
        });
      });
    } else if (extractionStats.isDirectory()) {
      await gameFilesManager
        .extractFilesInDirectory(extractionPath)
        .then(async (success) => {
          if (success) {
            await gameFilesManager.setExtractionComplete();
          }
        })
        .catch((error) => {
          logger.error(
            "[DownloadManager] Failed to extract files in directory",
            error
          );
          return gameFilesManager.failExtraction(error).catch((failError) => {
            logger.error(
              "[DownloadManager] Failed to persist extraction failure state",
              failError
            );
          });
        });
    } else if (extractionStats.isFile()) {
      await gameFilesManager
        .handleUnsupportedExtraction(extractionPath, { notify: false })
        .catch((error) => {
          logger.error(
            "[DownloadManager] Failed to handle unsupported extraction format",
            error
          );
        });
    } else {
      await gameFilesManager
        .failExtraction(
          new Error(
            `Invalid extraction source type for "${download.folderName ?? "unknown"}"`
          )
        )
        .catch((error) => {
          logger.error(
            "[DownloadManager] Failed to persist extraction failure state",
            error
          );
        });
    }
  }

  public static clearQueueVerifyAttempt(
    download: Pick<Download, "shop" | "objectId">
  ): void {
    clearVerifyAttempt(
      this.queueVerifyAttempts,
      levelKeys.game(download.shop, download.objectId)
    );
  }

  private static async shouldBypassQueueHoldForVerify(
    download: Download
  ): Promise<boolean> {
    if (!isQueueVerifyCandidate(download)) return false;
    const key = levelKeys.game(download.shop, download.objectId);
    const sig = await getQueueVerifySig(
      path.join(download.downloadPath, download.folderName)
    );
    if (!sig) return false;
    const now = Date.now();
    const prev = this.queueVerifyAttempts.get(key);
    if (isVerifyAttemptFresh(prev, sig, now, QUEUE_VERIFY_TTL_MS)) return false;
    recordVerifyAttempt(
      this.queueVerifyAttempts,
      key,
      sig,
      now,
      QUEUE_VERIFY_MAX_ENTRIES
    );
    return true;
  }

  private static async processNextQueuedDownload() {
    const { DownloadOrchestrator } = await import("../download-orchestrator");
    await DownloadOrchestrator.pumpDownloadQueue();
  }

  public static async shouldHoldQueuedDownload(nextItemOnQueue: Download) {
    const diskSpace = await getDownloadDiskSpace(nextItemOnQueue);
    if (!diskSpace || diskSpace.hasEnoughSpace) return false;
    if (await this.shouldBypassQueueHoldForVerify(nextItemOnQueue))
      return false;

    if (!this.queueHeldForDiskSpace) {
      logger.warn(
        `[DownloadManager] Keeping the queue on hold: ${nextItemOnQueue.downloadPath} has ${diskSpace.freeBytes} bytes free, ${diskSpace.requiredBytes} needed`
      );
      WindowManager.sendDownloadsUpdated();
    }
    this.queueHeldForDiskSpace = true;
    return true;
  }

  private static getErrorMessage(error: unknown) {
    if (error instanceof Error) return error.message;
    if (typeof error === "string") return error;

    try {
      return JSON.stringify(error) ?? "Unknown error";
    } catch {
      return "Unknown error";
    }
  }

  static async handleRuntimeDownloadError(
    downloadId: string,
    error: unknown,
    generation?: number
  ) {
    const session = this.getSession(downloadId);
    if (session)
      return this.handleSessionRuntimeDownloadError(
        downloadId,
        error,
        generation,
        session
      );
  }

  private static async handleSessionRuntimeDownloadError(
    downloadId: string,
    error: unknown,
    generation: number | undefined,
    session: DownloadSession
  ) {
    if (
      (generation !== undefined && session.generation !== generation) ||
      session.preparationController.signal.aborted ||
      this.sessions.get(downloadId) !== session
    )
      return;

    const message = this.getErrorMessage(error);
    logger.error(
      `[DownloadManager] Download failed for ${downloadId}: ${message}`,
      error
    );
    session.preparationController.abort();
    if (session.epic) await getEpicDownloadService().stop(downloadId);
    else if (session.torrent)
      await TorrentService.call("action", {
        action: "cancel",
        game_id: downloadId,
      });
    else session.downloader?.cancelDownload(false);
    this.clearSession(downloadId, session);

    const download = await downloadsSublevel.get(downloadId);
    if (download) {
      await this.persistDownloadRecord(downloadId, {
        ...download,
        status: "error",
        queued: false,
        pinnedToHero: false,
        extracting: false,
        epic: download.epic
          ? { ...download.epic, error: epicManagedErrorCode(error) }
          : undefined,
      });
    }
    WindowManager.sendDownloadsUpdated();
    await this.processNextQueuedDownload();
  }

  public static async getSeedStatus() {
    let seedStatus: LibtorrentPayload[] = [];

    try {
      seedStatus = await TorrentService.call<LibtorrentPayload[] | []>(
        "seed_status"
      ).then((res) => res.data);
    } catch (error) {
      logger.error("[DownloadManager] Torrent seed status poll failed", error);
      WindowManager.sendToAppWindows("on-seeding-status", []);
      return;
    }

    if (!seedStatus.length) {
      WindowManager.sendToAppWindows("on-seeding-status", []);
      return;
    }

    logger.log(seedStatus);

    await Promise.all(
      seedStatus.map(async (status) => {
        const download = await downloadsSublevel.get(status.gameId);
        if (!download) return;

        const totalSize = await getDirSize(
          path.join(download.downloadPath, status.folderName)
        );
        if (totalSize >= status.fileSize) return;

        await this.pauseSeeding(status.gameId);
        await this.persistDownloadRecord(status.gameId, {
          ...download,
          status: "paused",
          shouldSeed: false,
          pinnedToHero: false,
          progress:
            status.fileSize > 0
              ? Math.min(totalSize / status.fileSize, 1)
              : download.progress,
        });
        WindowManager.sendDownloadsUpdated();
        WindowManager.sendToAppWindows("on-hard-delete");
      })
    );

    WindowManager.sendToAppWindows("on-seeding-status", seedStatus);
  }

  static async pauseDownload(downloadKey: string) {
    const session = this.getSession(downloadKey);
    if (session) return this.pauseSessionDownload(session);
  }

  private static async pauseSessionDownload(session: DownloadSession) {
    const sessionId = session.downloadId;
    if (session.epic) {
      session.preparationController.abort();
      await getEpicDownloadService().stop(sessionId);
    } else if (session.torrent) {
      session.preparationController.abort();
      await TorrentService.call("action", {
        action: "pause",
        game_id: sessionId,
      });
    } else if (session.downloader) {
      session.downloader.pauseDownload();
      await session.downloader.waitForIdle();
      await this.persistPausedJsProgress(
        sessionId,
        () => this.sessions.get(sessionId) === session
      );
    }
    session.preparationController.abort();
    this.clearSession(sessionId, session);
  }

  private static async persistPausedJsProgress(
    downloadKey: string,
    isCurrent: () => boolean
  ) {
    const status = await this.getDownloadStatusFromJs(downloadKey);
    if (!isCurrent()) return;
    const download = await downloadsSublevel.get(downloadKey);
    if (!isCurrent()) return;
    if (status?.download && download) {
      await this.persistDownloadRecord(downloadKey, {
        ...download,
        bytesDownloaded: status.download.bytesDownloaded,
        progress: status.download.progress,
        files: status.download.files,
        folderName: status.download.folderName,
        fileSize: status.download.fileSize,
      });
    }
  }

  static async resumeDownload(download: Download, signal?: AbortSignal) {
    return this.startDownload(download, signal);
  }

  public static requiresPauseConfirmation(downloadKey: string): boolean {
    const session = this.getSession(downloadKey);
    const batch = session?.batch;
    const entry = batch?.entries[batch.currentIndex];
    return (
      !!session?.downloader &&
      batch?.provider === "torBox" &&
      entry?.isZip === true &&
      session?.downloader?.getDownloadStatus()?.resumeCapability ===
        "unsupported"
    );
  }

  public static confirmPauseDownload(
    downloadKey: string,
    confirmed = false
  ): boolean {
    return confirmed || !this.requiresPauseConfirmation(downloadKey);
  }

  public static async prepareRealDebridDownload(
    download: Download,
    signal?: AbortSignal
  ): Promise<boolean> {
    const downloadId = levelKeys.game(download.shop, download.objectId);
    const resolved = await RealDebridClient.getDownloadEntriesWithTorrent(
      download.uri,
      download.fileIndices,
      download.realDebridTorrentId,
      signal
    );
    signal?.throwIfAborted();
    download.realDebridTorrentId =
      resolved.torrentId ?? download.realDebridTorrentId;
    if (!resolved.entries?.length) return false;
    this.preparedRealDebridDownloads.set(downloadId, {
      uri: download.uri,
      selection: JSON.stringify(download.fileIndices),
      resolvedAt: Date.now(),
      resolved,
    });
    return true;
  }

  static async cancelDownload(downloadKey: string) {
    if (downloadKey) this.preparedRealDebridDownloads.delete(downloadKey);
    const session = downloadKey ? this.getSession(downloadKey) : null;
    if (session) {
      const sessionId = session.downloadId;
      session.preparationController.abort();
      if (session.epic) {
        await getEpicDownloadService().stop(sessionId);
      } else if (session.torrent) {
        await TorrentService.call("action", {
          action: "cancel",
          game_id: sessionId,
        });
      } else if (session.downloader) {
        if (session.downloader.getDownloadStatus()?.status !== "complete") {
          session.downloader.pauseDownload();
        }
        await session.downloader.waitForIdle();
        session.downloader.cancelDownload();
      }
      this.clearSession(sessionId, session);
      return;
    }
    if (downloadKey) {
      const download = await downloadsSublevel.get(downloadKey);
      if (download?.downloader === Downloader.Epic) {
        await getEpicDownloadService().stop(downloadKey);
        return;
      }
      await TorrentService.call("action", {
        action: "cancel",
        game_id: downloadKey,
      }).catch((err) => logger.error("Failed to cancel game download", err));
    }
  }

  static async resumeSeeding(download: Download) {
    await TorrentService.call("action", {
      action: "resume_seeding",
      game_id: levelKeys.game(download.shop, download.objectId),
      url: download.uri,
      save_path: download.downloadPath,
      trackers: download.customTrackers,
    });
  }

  static async pauseSeeding(downloadKey: string) {
    await TorrentService.call("action", {
      action: "pause_seeding",
      game_id: downloadKey,
    });
  }

  private static async getJsDownloadOptions(
    download: Download
  ): Promise<JsDownloadOptions | null> {
    const resumingFilename = download.folderName || undefined;

    switch (download.downloader) {
      case Downloader.Gofile:
        return this.getGofileDownloadOptions(download, resumingFilename);
      case Downloader.PixelDrain:
        return this.getPixelDrainDownloadOptions(download, resumingFilename);
      case Downloader.Datanodes:
        return this.getDatanodesDownloadOptions(download, resumingFilename);
      case Downloader.FuckingFast:
        return this.getFuckingFastDownloadOptions(download, resumingFilename);
      case Downloader.Mediafire:
        return this.getMediafireDownloadOptions(download, resumingFilename);
      case Downloader.RealDebrid:
        return this.getRealDebridDownloadOptions(download, resumingFilename);
      case Downloader.Premiumize:
        return this.getPremiumizeDownloadOptions(download, resumingFilename);
      case Downloader.AllDebrid:
        return this.getAllDebridDownloadOptions(download, resumingFilename);
      case Downloader.TorBox:
        return this.getTorBoxDownloadOptions(download);
      case Downloader.Hydra:
        throw new Error(DownloadError.NotCachedOnHydra);
      case Downloader.VikingFile:
        return this.getVikingFileDownloadOptions(download, resumingFilename);
      case Downloader.Rootz:
        return this.getRootzDownloadOptions(download, resumingFilename);
      case Downloader.ArchiveOrg:
        return this.getArchiveOrgDownloadOptions(download, resumingFilename);
      default:
        return null;
    }
  }

  private static async resolveBatchEntryUrl(
    batch: JsBatchState,
    entry: JsBatchEntry,
    reusePreparedLink = false
  ): Promise<string | undefined> {
    this.assertSafeBatchPath(batch.savePath, entry.filename);
    const url = entry.url;
    if (batch.provider === "torBox") {
      if (batch.torrentId === undefined || entry.fileId === undefined) {
        throw new Error("The TorBox file selection is incomplete.");
      }
      return TorBoxClient.requestLink(batch.torrentId, entry.fileId);
    }
    if (batch.provider === "realDebrid" && entry.isLocked && url) {
      const prepared = entry.preparedLink;
      entry.preparedLink = undefined;
      const age = prepared ? Date.now() - prepared.resolvedAt : Infinity;
      if (
        reusePreparedLink &&
        prepared?.url &&
        age >= 0 &&
        age < this.PREPARED_JS_DOWNLOAD_TTL_MS
      ) {
        return prepared.url;
      }
      const unlocked = await RealDebridClient.unlockFileWithDetails(
        url,
        entry.sourcePath ?? entry.filename,
        entry.isZip ? 0 : (entry.size ?? 0),
        this.getSession(batch.downloadId)?.preparationController.signal
      );
      entry.chunks = unlocked.chunks;
      return unlocked.url;
    }
    if (batch.provider === "allDebrid" && entry.isLocked && url) {
      return AllDebridClient.unlockDownloadLink(url);
    }
    return url;
  }

  private static getBatchDownloadOptions(
    batch: JsBatchState,
    entry: JsBatchEntry,
    url: string
  ): JsHttpDownloaderOptions {
    const torBoxParallel = batch.provider === "torBox" && !entry.isZip;
    const resourceId = this.getBatchResourceId(batch, entry);
    const options: JsHttpDownloaderOptions = {
      url,
      savePath: batch.savePath,
      allowParallelRanges:
        batch.provider === "allDebrid"
          ? undefined
          : !entry.isZip &&
            (batch.provider === "torBox" ||
              (batch.provider === "realDebrid" &&
                !isZipDownloadUrl(url, entry.filename))),
      parallelRangeSize: torBoxParallel
        ? getRangeSizeForRequestBudget(
            entry.size ?? 0,
            TORBOX_MAX_PARALLEL_RANGES
          )
        : undefined,
      probeUnboundedRange: batch.provider === "realDebrid",
      parallelRangeConnections:
        batch.provider === "realDebrid"
          ? realDebridConnections(entry.chunks)
          : undefined,
      maxParallelRanges: torBoxParallel
        ? TORBOX_MAX_PARALLEL_RANGES
        : undefined,
      preserveFilename: true,
      requireResourceIdentity:
        batch.provider === "realDebrid" &&
        (entry.isZip === true ||
          readResourceIdentity(path.join(batch.savePath, entry.filename)) !==
            null),
      resourceId,
      beforeComplete:
        batch.provider === "realDebrid"
          ? (filePath) => saveCompletedResourceIdentity(filePath, resourceId)
          : undefined,
      expectedSize:
        (batch.provider === "torBox" || batch.provider === "realDebrid") &&
        !entry.isZip
          ? entry.size
          : undefined,
      requireRangeResume:
        batch.provider === "realDebrid" ||
        (!entry.isZip && batch.provider === "torBox"),
      // Verify saved bytes even for single-connection Real-Debrid files.
      verifyResumePrefix:
        batch.provider === "realDebrid" || Boolean(entry.isZip),
      filename:
        batch.provider === "torBox"
          ? entry.filename
          : this.sanitizeRelativePath(entry.filename),
    };
    options.refreshUrl = this.getBatchUrlRefresh(batch, entry, options);
    return options;
  }

  private static getBatchResourceId(
    batch: JsBatchState,
    entry: JsBatchEntry
  ): string {
    return (
      entry.resourceId ??
      `${batch.provider}:${batch.sourceUri}#${entry.fileId ?? entry.fileIndex ?? entry.sourcePath ?? entry.filename}`
    );
  }

  private static getBatchUrlRefresh(
    batch: JsBatchState,
    entry: JsBatchEntry,
    options: JsHttpDownloaderOptions
  ) {
    const { torrentId } = batch;
    const { fileId } = entry;
    if (
      batch.provider === "torBox" &&
      torrentId !== undefined &&
      fileId !== undefined
    ) {
      return () => TorBoxClient.requestLink(torrentId, fileId);
    }
    if (batch.provider !== "realDebrid" || !entry.url) return undefined;
    return async () => {
      const link = await this.resolveBatchEntryUrl(batch, entry);
      if (!link) throw new Error("The download link is unavailable.");
      options.parallelRangeConnections = realDebridConnections(entry.chunks);
      return link;
    };
  }

  private static async rejectMismatchedBatchEntry(
    batch: JsBatchState,
    entry: JsBatchEntry,
    downloader: JsHttpDownloader,
    status: JsHttpDownloaderStatus
  ): Promise<boolean> {
    const expectedSize = entry.size ?? 0;
    const requiresExactSize =
      batch.provider === "torBox" || batch.provider === "realDebrid";
    const sizeMismatch =
      !entry.isZip &&
      (requiresExactSize
        ? status.bytesDownloaded !== expectedSize
        : expectedSize > 0 &&
          status.bytesDownloaded < expectedSize * MIN_BATCH_COMPLETION_RATIO);
    if (!sizeMismatch) return false;

    logger.error(
      `[DownloadManager] ${batch.provider} batch entry ${batch.currentIndex} size mismatch: ` +
        `downloaded=${status.bytesDownloaded} expected=${expectedSize}. ` +
        `The download URL may have returned an error page.`
    );
    const generation = batch.generation!;
    const mismatchDownloadId = batch.downloadId;
    if (!this.isCurrentBatch(batch, downloader, generation)) return true;
    if (!(await this.cleanupBatch(batch, downloader, generation))) return true;
    if (mismatchDownloadId) {
      await this.handleRuntimeDownloadError(
        mismatchDownloadId,
        new Error(
          "A downloaded file returned fewer bytes than expected. Its link may have expired."
        ),
        generation
      );
    }
    return true;
  }

  private static bankCompletedBatchEntry(
    batch: JsBatchState,
    entry: JsBatchEntry,
    status: JsHttpDownloaderStatus
  ): void {
    const expectedSize = entry.size ?? 0;
    if (entry.isZip && expectedSize !== status.bytesDownloaded) {
      batch.totalBytes += status.bytesDownloaded - expectedSize;
      entry.size = status.bytesDownloaded;
    }
    const bankedBytes =
      entry.isZip || !entry.size || entry.size <= 0
        ? status.bytesDownloaded
        : entry.size;
    batch.completedBytes += bankedBytes;
    batch.currentIndex += 1;
  }

  private static async runJsBatchEntry(
    batch: JsBatchState,
    downloader: JsHttpDownloader,
    entry: JsBatchEntry
  ): Promise<boolean> {
    const generation = batch.generation!;
    try {
      if (!this.isCurrentBatch(batch, downloader, generation)) return false;
      const url =
        (batch.provider === "torBox" || batch.provider === "realDebrid") &&
        !entry.isZip &&
        entry.size === 0
          ? "about:blank"
          : await this.resolveBatchEntryUrl(batch, entry, true);
      if (!this.isCurrentBatch(batch, downloader, generation)) {
        return false;
      }
      if (!url) throw new Error("The download link is unavailable.");

      const options = this.getBatchDownloadOptions(batch, entry, url);
      this.logResolvedUrl(options.url);
      batch.activeIndex = batch.currentIndex;
      await downloader.startDownload(options);

      if (!this.isCurrentBatch(batch, downloader, generation)) {
        return false;
      }
      const status = downloader.getDownloadStatus();
      if (!status || status.status === "paused" || status.status === "error") {
        return false;
      }
      if (
        await this.rejectMismatchedBatchEntry(batch, entry, downloader, status)
      ) {
        return false;
      }
      this.bankCompletedBatchEntry(batch, entry, status);
      return true;
    } catch (err) {
      await this.failJsBatchEntry(batch, downloader, generation, err);
      return false;
    }
  }

  private static async failJsBatchEntry(
    batch: JsBatchState,
    downloader: JsHttpDownloader,
    generation: number,
    err: unknown
  ) {
    if (!this.isCurrentBatch(batch, downloader, generation)) return;
    logger.error(`[DownloadManager] ${batch.provider} batch entry error:`, err);
    const failedDownloadId = batch.downloadId;
    const status = await this.getDownloadStatusFromJs(failedDownloadId);
    if (!this.isCurrentBatch(batch, downloader, generation)) return;
    const download = failedDownloadId
      ? await downloadsSublevel.get(failedDownloadId)
      : null;
    if (!this.isCurrentBatch(batch, downloader, generation)) return;
    if (failedDownloadId && download && status?.download) {
      await this.persistDownloadRecord(failedDownloadId, {
        ...download,
        bytesDownloaded: status.download.bytesDownloaded,
        progress: status.download.progress,
        fileSize: status.download.fileSize,
        folderName: status.download.folderName,
      });
    }
    if (!(await this.cleanupBatch(batch, downloader, generation))) return;
    if (failedDownloadId) {
      await this.handleRuntimeDownloadError(failedDownloadId, err, generation);
    }
  }

  private static async runJsBatch(downloadId: string) {
    const session = downloadId ? this.getSession(downloadId) : null;
    while (session?.batch && session.downloader) {
      const batch = session?.batch;
      const downloader = session?.downloader;
      if (!(downloader instanceof JsHttpDownloader)) break;
      if (!batch) break;
      const entry = batch.entries[batch.currentIndex];
      if (!entry) break;
      if (!(await this.runJsBatchEntry(batch, downloader, entry))) break;
    }
  }

  private static isCurrentBatch(
    batch: JsBatchState,
    downloader: JsHttpDownloader,
    generation: number
  ): boolean {
    const session = this.getSession(batch.downloadId);
    if (session) {
      return (
        session.batch === batch &&
        session.downloader === downloader &&
        session.generation === generation &&
        !session.preparationController.signal.aborted
      );
    }
    return false;
  }

  private static async cleanupBatch(
    batch: JsBatchState,
    downloader: JsHttpDownloader,
    generation: number
  ): Promise<boolean> {
    // A failed request does not invalidate the bytes already saved. Only an
    // explicit cancellation or confirmed invalid output may remove them.
    if (!this.isCurrentBatch(batch, downloader, generation)) return false;
    await downloader?.waitForIdle();
    if (!this.isCurrentBatch(batch, downloader, generation)) return false;
    downloader?.cancelDownload(false);
    const session = this.getSession(batch.downloadId);
    if (session) {
      session.downloader = null;
      session.batch = null;
      session.isPreparing = false;
    }
    return true;
  }

  private static async getGofileDownloadOptions(
    download: Download,
    resumingFilename?: string
  ) {
    const { id, password } = this.parseGofileUri(download.uri);
    if (!id) {
      throw new Error("Invalid gofile URL");
    }

    const { url, headers } = await this.resolveGofileDownload(id, password);

    const filename = this.resolveFilename(resumingFilename, download.uri, url);
    return this.buildDownloadOptions(
      url,
      download.downloadPath,
      filename,
      headers
    );
  }

  private static async resolveGofileDownload(
    id: string,
    password?: string
  ): Promise<{
    url: string;
    headers?: Record<string, string>;
  }> {
    try {
      const downloadLink = await GofileApi.getDownloadLink(id, password);
      await GofileApi.checkDownloadUrl(downloadLink);
      const token = await GofileApi.authorize();

      logger.log(
        `[DownloadManager] GoFile download ${id} will use the official downloader`
      );

      return {
        url: downloadLink,
        headers: { Cookie: `accountToken=${token}` },
      };
    } catch (error) {
      logger.warn(
        `[DownloadManager] Official GoFile downloader failed for ${id}; checking alternate CDN`,
        error
      );

      const alternateCdnDownloadLink =
        await GofileApi.getAlternateCdnDownloadLinkIfAvailable(id);

      if (!alternateCdnDownloadLink) {
        throw error;
      }

      logger.log(
        `[DownloadManager] GoFile download ${id} will use alternate CDN`
      );

      return { url: alternateCdnDownloadLink };
    }
  }

  private static async getPixelDrainDownloadOptions(
    download: Download,
    resumingFilename?: string
  ) {
    const downloadUrl = await PixelDrainApi.unlock(download.uri);
    const filename = this.resolveFilename(
      resumingFilename,
      download.uri,
      downloadUrl
    );
    return this.buildDownloadOptions(
      downloadUrl,
      download.downloadPath,
      filename
    );
  }

  private static async getDatanodesDownloadOptions(
    download: Download,
    resumingFilename?: string
  ) {
    const downloadUrl = await DatanodesApi.getDownloadUrl(download.uri);
    const filename = this.resolveFilename(
      resumingFilename,
      download.uri,
      downloadUrl
    );
    return this.buildDownloadOptions(
      downloadUrl,
      download.downloadPath,
      filename
    );
  }

  private static async getFuckingFastDownloadOptions(
    download: Download,
    resumingFilename?: string
  ) {
    logger.log(
      `[DownloadManager] Processing FuckingFast download for URI: ${download.uri}`
    );
    const directUrl = await FuckingFastApi.getDirectLink(download.uri);
    const filename = this.resolveFilename(
      resumingFilename,
      download.uri,
      directUrl
    );
    return this.buildDownloadOptions(
      directUrl,
      download.downloadPath,
      filename
    );
  }

  private static async getMediafireDownloadOptions(
    download: Download,
    resumingFilename?: string
  ) {
    const downloadUrl = await MediafireApi.getDownloadUrl(download.uri);
    const filename = this.resolveFilename(
      resumingFilename,
      download.uri,
      downloadUrl
    );
    return this.buildDownloadOptions(
      downloadUrl,
      download.downloadPath,
      filename
    );
  }

  private static async getRealDebridDownloadOptions(
    download: Download,
    resumingFilename?: string
  ) {
    const resolved = await RealDebridClient.getDownloadEntriesWithTorrent(
      download.uri,
      download.fileIndices,
      download.realDebridTorrentId
    );
    if (resolved.torrentId) download.realDebridTorrentId = resolved.torrentId;
    const entries = resolved.entries;
    const first = entries?.[0];
    let downloadUrl: string | null = null;
    if (first) {
      const expectedSize = first.isArchive ? 0 : first.size;
      downloadUrl =
        first.preparedLink?.url ??
        (first.isLocked
          ? await RealDebridClient.unlockFile(
              first.url,
              first.sourcePath ?? first.path,
              expectedSize
            )
          : first.url);
    }
    if (!downloadUrl) throw new Error(DownloadError.NotCachedOnRealDebrid);
    const filename = this.resolveFilename(
      resumingFilename,
      download.uri,
      downloadUrl
    );
    return {
      ...this.buildDownloadOptions(
        downloadUrl,
        download.downloadPath,
        filename
      ),
      allowParallelRanges: !isZipDownloadUrl(downloadUrl, first?.path),
      parallelRangeConnections: realDebridConnections(first?.chunks),
      probeUnboundedRange: true,
      totalSize: entries?.reduce((sum, entry) => sum + entry.size, 0),
    };
  }

  private static async getPremiumizeDownloadOptions(
    download: Download,
    resumingFilename?: string
  ) {
    const downloadUrl = await PremiumizeClient.getDownloadUrl(download.uri);
    if (!downloadUrl) throw new Error(DownloadError.NotCachedOnPremiumize);
    const filename = this.resolveFilename(
      resumingFilename,
      download.uri,
      downloadUrl
    );
    return this.buildDownloadOptions(
      downloadUrl,
      download.downloadPath,
      filename
    );
  }

  private static async getAllDebridDownloadOptions(
    download: Download,
    resumingFilename?: string
  ) {
    const downloadInfo = await AllDebridClient.getDownloadInfo(download.uri);
    if (!downloadInfo?.url) throw new Error(DownloadError.NotCachedOnAllDebrid);
    const filename = resumingFilename
      ? this.sanitizeRelativePath(resumingFilename)
      : downloadInfo.filename
        ? this.sanitizeRelativePath(downloadInfo.filename)
        : this.resolveFilename(undefined, download.uri, downloadInfo.url);
    return this.buildDownloadOptions(
      downloadInfo.url,
      download.downloadPath,
      filename
    );
  }

  private static readLocalFileProgress(
    downloadPath: string,
    files: { index: number; path: string; size?: number }[]
  ): DownloadFile[] {
    return files.map((file) => {
      this.assertSafeBatchPath(downloadPath, file.path);
      const localPath = path.join(downloadPath, file.path);
      const bytesDownloaded = getRangeDownloadedBytes(localPath);
      return {
        index: file.index,
        path: file.path,
        size: file.size ?? 0,
        bytesDownloaded,
        completed: fs.existsSync(localPath) && bytesDownloaded === file.size,
      };
    });
  }

  private static getDebridOutputPath(
    download: Download,
    file: { index: number; path: string },
    fileCount: number
  ): string {
    if (fileCount !== 1 || !file.path.toLowerCase().endsWith(".zip"))
      return file.path;
    const filename = file.path.split(/[\\/]/).at(-1)!;
    // Keep existing partials at their original path; new single ZIPs need no wrapper folder.
    const previous = download.files?.find((item) => item.index === file.index);
    const existingPath = previous?.path ?? file.path;
    this.assertSafeBatchPath(download.downloadPath, existingPath);
    if (
      existingPath.split(/[\\/]/).at(-1) === filename &&
      getRangeDownloadedBytes(path.join(download.downloadPath, existingPath)) >
        0
    )
      return existingPath;
    return filename;
  }

  private static async prepareTorBoxFiles(download: Download) {
    const manifest = await TorBoxClient.getDownloadFiles(download.uri);
    const selectedFiles = selectTorBoxFiles(manifest, download.fileIndices);
    const selected = selectedFiles.map((file) => ({
      ...file,
      path: this.getDebridOutputPath(
        download,
        { index: file.id, path: file.path },
        selectedFiles.length
      ),
    }));
    download.files = this.readLocalFileProgress(
      download.downloadPath,
      selected.map((file) => ({
        index: file.id,
        path: file.path,
        size: file.size,
      }))
    );
    return { manifest, selected };
  }

  private static async getTorBoxDownloadOptions(download: Download) {
    const { manifest, selected } = await this.prepareTorBoxFiles(download);
    const firstFile = selected[0];
    const url =
      firstFile.size === 0
        ? "about:blank"
        : await TorBoxClient.requestLink(manifest.torrentId, firstFile.id);
    return {
      ...this.buildDownloadOptions(url, download.downloadPath, firstFile.path),
      totalSize: selected.reduce((sum, file) => sum + file.size, 0),
    };
  }

  private static async getVikingFileDownloadOptions(
    download: Download,
    resumingFilename?: string
  ) {
    logger.log(
      `[DownloadManager] Processing VikingFile download for URI: ${download.uri}`
    );
    const downloadUrl = await VikingFileApi.getDownloadUrl(download.uri);
    const filename = this.resolveFilename(
      resumingFilename,
      download.uri,
      downloadUrl
    );
    return this.buildDownloadOptions(
      downloadUrl,
      download.downloadPath,
      filename
    );
  }

  private static async getArchiveOrgDownloadOptions(
    download: Download,
    resumingFilename?: string
  ) {
    const resolvedFile = resolveArchiveOrgFile(download.uri);
    if (!resolvedFile) throw new Error(DownloadError.ArchiveOrgInvalidFileUrl);

    return this.buildDownloadOptions(
      resolvedFile.url,
      download.downloadPath,
      resumingFilename ?? this.sanitizeFilename(resolvedFile.filename)
    );
  }

  private static async getRootzDownloadOptions(
    download: Download,
    resumingFilename?: string
  ) {
    const downloadUrl = await RootzApi.getDownloadUrl(download.uri);
    const filename = this.resolveFilename(
      resumingFilename,
      download.uri,
      downloadUrl
    );
    return this.buildDownloadOptions(
      downloadUrl,
      download.downloadPath,
      filename
    );
  }

  private static async getDownloadPayload(download: Download) {
    const downloadId = levelKeys.game(download.shop, download.objectId);

    switch (download.downloader) {
      case Downloader.Gofile: {
        const { id, password } = this.parseGofileUri(download.uri);
        if (!id) {
          throw new Error("Invalid gofile URL");
        }

        const { url, headers } = await this.resolveGofileDownload(id, password);
        const payload = {
          action: "start" as const,
          game_id: downloadId,
          url,
          save_path: download.downloadPath,
          allow_multiple_connections: true,
          connections_limit: 8,
        };

        if (headers?.Cookie) {
          return {
            ...payload,
            header: `Cookie: ${headers.Cookie}`,
          };
        }

        return payload;
      }
      case Downloader.PixelDrain: {
        const downloadUrl = await PixelDrainApi.unlock(download.uri);

        return {
          action: "start",
          game_id: downloadId,
          url: downloadUrl,
          save_path: download.downloadPath,
        };
      }
      case Downloader.Datanodes: {
        const downloadUrl = await DatanodesApi.getDownloadUrl(download.uri);
        return {
          action: "start",
          game_id: downloadId,
          url: downloadUrl,
          save_path: download.downloadPath,
        };
      }
      case Downloader.FuckingFast: {
        logger.log(
          `[DownloadManager] Processing FuckingFast download for URI: ${download.uri}`
        );
        try {
          const directUrl = await FuckingFastApi.getDirectLink(download.uri);
          logger.log(`[DownloadManager] FuckingFast direct URL obtained`);
          return this.createDownloadPayload(
            directUrl,
            download.uri,
            downloadId,
            download.downloadPath
          );
        } catch (error) {
          logger.error(
            `[DownloadManager] Error processing FuckingFast download:`,
            error
          );
          throw error;
        }
      }
      case Downloader.Mediafire: {
        const downloadUrl = await MediafireApi.getDownloadUrl(download.uri);
        return {
          action: "start",
          game_id: downloadId,
          url: downloadUrl,
          save_path: download.downloadPath,
        };
      }
      case Downloader.Torrent: {
        const hasSelectedFileIndices =
          Array.isArray(download.fileIndices) &&
          download.fileIndices.length > 0;

        return {
          action: "start",
          game_id: downloadId,
          url: download.uri,
          save_path: download.downloadPath,
          file_indices: hasSelectedFileIndices
            ? download.fileIndices
            : undefined,
          metadata_timeout_ms: hasSelectedFileIndices
            ? SELECTIVE_TORRENT_METADATA_TIMEOUT_MS
            : undefined,
          trackers: download.customTrackers,
        };
      }
      case Downloader.RealDebrid: {
        const downloadUrl = await RealDebridClient.getDownloadUrl(download.uri);
        if (!downloadUrl) throw new Error(DownloadError.NotCachedOnRealDebrid);

        return {
          action: "start",
          game_id: downloadId,
          url: downloadUrl,
          save_path: download.downloadPath,
          allow_multiple_connections: true,
        };
      }
      case Downloader.Premiumize: {
        const downloadUrl = await PremiumizeClient.getDownloadUrl(download.uri);
        if (!downloadUrl) throw new Error(DownloadError.NotCachedOnPremiumize);

        return {
          action: "start",
          game_id: downloadId,
          url: downloadUrl,
          save_path: download.downloadPath,
          allow_multiple_connections: true,
        };
      }
      case Downloader.AllDebrid: {
        const downloadInfo = await AllDebridClient.getDownloadInfo(
          download.uri
        );
        if (!downloadInfo?.url)
          throw new Error(DownloadError.NotCachedOnAllDebrid);

        const filename = downloadInfo.filename
          ? this.sanitizeRelativePath(downloadInfo.filename)
          : undefined;
        return {
          action: "start",
          game_id: downloadId,
          url: downloadInfo.url,
          save_path: download.downloadPath,
          out: filename,
          allow_multiple_connections: true,
        };
      }
      case Downloader.TorBox:
        throw new Error("TorBox folders require the HTTP download manager.");
      case Downloader.Hydra: {
        throw new Error(DownloadError.NotCachedOnHydra);
      }
      case Downloader.VikingFile: {
        logger.log(
          `[DownloadManager] Processing VikingFile download for URI: ${download.uri}`
        );
        const downloadUrl = await VikingFileApi.getDownloadUrl(download.uri);
        return this.createDownloadPayload(
          downloadUrl,
          download.uri,
          downloadId,
          download.downloadPath
        );
      }
      case Downloader.Rootz: {
        const downloadUrl = await RootzApi.getDownloadUrl(download.uri);
        return {
          action: "start",
          game_id: downloadId,
          url: downloadUrl,
          save_path: download.downloadPath,
        };
      }
      default:
        return undefined;
    }
  }

  static async validateDownloadUrl(
    download: Download,
    signal?: AbortSignal
  ): Promise<void> {
    signal?.throwIfAborted();
    if (!this.isHttpDownloader(download.downloader)) return;

    const downloadId = levelKeys.game(download.shop, download.objectId);
    this.preparedJsDownloads.delete(downloadId);

    const options =
      download.downloader === Downloader.TorBox
        ? await this.getTorBoxDownloadOptions(download)
        : await this.getJsDownloadOptions(download);
    if (!options) {
      throw new Error("Failed to validate download URL");
    }

    if (
      "totalSize" in options &&
      typeof options.totalSize === "number" &&
      options.totalSize > 0
    ) {
      download.fileSize = options.totalSize;
      download.selectedFilesSize = options.totalSize;
    }

    signal?.throwIfAborted();
    if (
      !(
        download.downloader === Downloader.TorBox &&
        download.files?.[0]?.size === 0
      )
    ) {
      await this.validateJsDownloadResponse(options, signal);
    }
    signal?.throwIfAborted();

    this.prunePreparedJsDownloads();
    this.preparedJsDownloads.set(downloadId, {
      uri: download.uri,
      resolvedAt: Date.now(),
      options,
    });
  }

  private static prunePreparedJsDownloads() {
    for (const [key, prepared] of this.preparedJsDownloads) {
      if (Date.now() - prepared.resolvedAt > this.PREPARED_JS_DOWNLOAD_TTL_MS) {
        this.preparedJsDownloads.delete(key);
      }
    }
  }

  private static takePreparedJsDownload(
    download: Download,
    downloadId: string
  ): JsDownloadOptions | null {
    const prepared = this.preparedJsDownloads.get(downloadId);
    if (!prepared) return null;

    this.preparedJsDownloads.delete(downloadId);

    if (prepared.uri !== download.uri) return null;
    if (Date.now() - prepared.resolvedAt > this.PREPARED_JS_DOWNLOAD_TTL_MS) {
      return null;
    }

    return prepared.options;
  }

  private static buildPreflightHeaders(
    base?: Record<string, string>
  ): Record<string, string> {
    const headers: Record<string, string> = { ...base };

    const hasUserAgentHeader = Object.keys(headers).some(
      (key) => key.toLowerCase() === "user-agent"
    );
    if (!hasUserAgentHeader) {
      headers["User-Agent"] = DEFAULT_DOWNLOAD_USER_AGENT;
    }

    const hasAcceptEncoding = Object.keys(headers).some(
      (key) => key.toLowerCase() === "accept-encoding"
    );
    if (!hasAcceptEncoding) {
      headers["Accept-Encoding"] = "identity";
    }

    const hasRange = Object.keys(headers).some(
      (key) => key.toLowerCase() === "range"
    );
    if (!hasRange) {
      headers["Range"] = "bytes=0-0";
    }

    return headers;
  }

  private static async runPreflightAttempt(
    url: string,
    headers: Record<string, string>,
    attempt: number,
    maxAttempts: number,
    signal?: AbortSignal
  ): Promise<"done" | "retry"> {
    const controller = new AbortController();
    const timeoutId = setTimeout(
      () => controller.abort(),
      PREFLIGHT_TIMEOUT_MS
    );

    try {
      const response = await fetch(url, {
        method: "GET",
        headers,
        signal: signal
          ? AbortSignal.any([signal, controller.signal])
          : controller.signal,
      });
      const contentType = response.headers.get("content-type") ?? "unknown";
      const contentLength = response.headers.get("content-length") ?? "unknown";

      logger.log(
        `[DownloadManager] Preflight response status=${response.status} content-type=${contentType} content-length=${contentLength}`
      );

      await response.body?.cancel().catch(() => undefined);

      if (response.status === 416) {
        logger.log(
          "[DownloadManager] Preflight range was rejected but the link resolved; allowing the download to start"
        );
        return "done";
      }

      if (isRetryableHttpStatus(response.status)) {
        if (attempt < maxAttempts) {
          logger.log(
            `[DownloadManager] Preflight got transient HTTP ${response.status}; retrying (${attempt}/${maxAttempts})`
          );
          return "retry";
        }

        logger.warn(
          `[DownloadManager] Preflight still HTTP ${response.status} after ${maxAttempts} attempts; allowing the download to start and retry`
        );
        return "done";
      }

      if (response.status >= 400) {
        throw new Error(
          `The download link is not available (HTTP ${response.status}).`
        );
      }

      if (
        contentType.includes("text/html") ||
        contentType.includes("application/xhtml")
      ) {
        throw new Error(DownloadError.DownloadLinkReturnedWebPage);
      }

      return "done";
    } catch (error) {
      signal?.throwIfAborted();
      if (error instanceof Error && error.name === "AbortError") {
        throw new Error("Download URL validation timed out");
      }

      logger.error(
        `[DownloadManager] Preflight request failed: ${describeErrorCause(error)}`
      );

      throw error;
    } finally {
      clearTimeout(timeoutId);
    }
  }

  private static async validateJsDownloadResponse(
    options: {
      url: string;
      headers?: Record<string, string>;
    },
    signal?: AbortSignal
  ) {
    await this.validatePreflightAttempt(
      options.url,
      this.buildPreflightHeaders(options.headers),
      signal
    );
  }

  private static async validatePreflightAttempt(
    url: string,
    headers: Record<string, string>,
    signal?: AbortSignal,
    attempt = 1
  ): Promise<void> {
    const verdict = await this.runPreflightAttempt(
      url,
      headers,
      attempt,
      PREFLIGHT_MAX_ATTEMPTS,
      signal
    );
    if (verdict === "done") return;
    await sleep(PREFLIGHT_RETRY_DELAY_MS * attempt, undefined, { signal });
    if (attempt < PREFLIGHT_MAX_ATTEMPTS)
      await this.validatePreflightAttempt(url, headers, signal, attempt + 1);
  }

  private static isCurrentStart(
    downloadId: string,
    generation: number,
    signal?: AbortSignal
  ) {
    const session = this.getSession(downloadId);
    if (session) {
      return (
        !signal?.aborted &&
        this.sessions.get(downloadId) === session &&
        session.generation === generation &&
        !session.preparationController.signal.aborted
      );
    }
    return false;
  }

  private static async resolvePreparedRealDebridEntries(
    download: Download,
    downloadId: string,
    myGeneration: number,
    signal: AbortSignal
  ) {
    const prepared = this.preparedRealDebridDownloads.get(downloadId);
    this.preparedRealDebridDownloads.delete(downloadId);
    const resolved =
      prepared?.uri === download.uri &&
      prepared.selection === JSON.stringify(download.fileIndices) &&
      prepared.resolved.torrentId === download.realDebridTorrentId &&
      Date.now() - prepared.resolvedAt < this.PREPARED_JS_DOWNLOAD_TTL_MS
        ? prepared.resolved
        : await RealDebridClient.getDownloadEntriesWithTorrent(
            download.uri,
            download.fileIndices,
            download.realDebridTorrentId,
            signal
          );
    signal.throwIfAborted();
    if (
      resolved.torrentId &&
      resolved.torrentId !== download.realDebridTorrentId &&
      this.isCurrentStart(downloadId, myGeneration, signal)
    ) {
      download.realDebridTorrentId = resolved.torrentId;
      await this.persistDownloadRecord(downloadId, download);
    }
    return resolved.entries;
  }

  private static async prepareTorBoxBatch(
    download: Download,
    downloadId: string
  ) {
    const { manifest, selected } = await this.prepareTorBoxFiles(download);
    const batchState: JsBatchState = {
      provider: "torBox",
      sourceUri: download.uri,
      downloadId,
      savePath: download.downloadPath,
      entries: selected.map((file) => ({
        fileId: file.id,
        filename: file.path,
        size: file.size,
        isZip: manifest.archiveOnly === true,
      })),
      torrentId: manifest.torrentId,
      rootFolderName:
        selected.length === 1 && !selected[0].path.includes("/")
          ? undefined
          : manifest.name,
      currentIndex: 0,
      activeIndex: -1,
      completedBytes: 0,
      totalBytes: selected.reduce((sum, file) => sum + file.size, 0),
      lastSpeedUpdate: Date.now(),
      bytesAtLastSpeedUpdate: null,
      batchSpeed: 0,
    };

    if (manifest.archiveOnly) this.skipCompletedTorBoxEntries(batchState);
    return batchState;
  }

  private static skipCompletedTorBoxEntries(batchState: JsBatchState) {
    // Completed earlier files need no new expiring TorBox link on resume.
    while (batchState.currentIndex < batchState.entries.length - 1) {
      const entry = batchState.entries[batchState.currentIndex];
      this.assertSafeBatchPath(batchState.savePath, entry.filename);
      const filePath = path.join(batchState.savePath, entry.filename);
      try {
        const stat = fs.statSync(filePath);
        const ranges = readRangeState(filePath);
        if (
          !stat.isFile() ||
          stat.size !== entry.size ||
          (ranges && savedRangeBytes(ranges) !== ranges.total)
        )
          break;
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === "ENOENT") break;
        throw error;
      }
      batchState.completedBytes += entry.size ?? 0;
      batchState.currentIndex += 1;
    }
  }

  private static async prepareAllDebridBatch(
    download: Download,
    downloadId: string
  ) {
    const entries = await AllDebridClient.getDownloadEntries(download.uri);
    if (!entries?.length) {
      throw new Error(DownloadError.NotCachedOnAllDebrid);
    }

    const batchState: JsBatchState = {
      provider: "allDebrid",
      sourceUri: download.uri,
      downloadId,
      savePath: download.downloadPath,
      entries: entries.map((entry) => ({
        ...entry,
        filename: this.sanitizeRelativePath(entry.filename),
      })),
      currentIndex: 0,
      activeIndex: -1,
      completedBytes: 0,
      totalBytes: entries.every((item) => typeof item.size === "number")
        ? entries.reduce((acc, item) => acc + (item.size ?? 0), 0)
        : 0,
      lastSpeedUpdate: Date.now(),
      bytesAtLastSpeedUpdate: null,
      batchSpeed: 0,
    };
    return batchState;
  }

  private static async prepareRealDebridBatch(
    download: Download,
    downloadId: string,
    myGeneration: number,
    signal: AbortSignal
  ) {
    const provider = "realDebrid";
    const entries = await this.resolvePreparedRealDebridEntries(
      download,
      downloadId,
      myGeneration,
      signal
    );
    if (!entries?.length) {
      throw new Error(DownloadError.NotCachedOnRealDebrid);
    }
    const batchState: JsBatchState = {
      provider,
      downloadId,
      savePath: download.downloadPath,
      entries: entries.map((entry) => ({
        url: entry.url,
        filename: this.sanitizeRelativePath(
          this.getDebridOutputPath(download, entry, entries.length)
        ),
        size: entry.size,
        isZip: entry.isArchive === true,
        resourceId: entry.resourceId,
        preparedLink: entry.preparedLink,
        isLocked: "isLocked" in entry && entry.isLocked === true,
        fileIndex: entry.index,
        sourcePath: entry.sourcePath ?? entry.path,
        chunks:
          "chunks" in entry && typeof entry.chunks === "number"
            ? entry.chunks
            : undefined,
      })),
      sourceUri: download.uri,
      rootFolderName: getDebridRootFolderName(
        entries.map((entry) => this.sanitizeRelativePath(entry.path))
      ),
      currentIndex: 0,
      activeIndex: -1,
      completedBytes: 0,
      totalBytes: entries.reduce((sum, entry) => sum + entry.size, 0),
      lastSpeedUpdate: Date.now(),
      bytesAtLastSpeedUpdate: null,
      batchSpeed: 0,
    };
    this.restoreRealDebridBatchProgress(download, batchState);

    return batchState;
  }

  private static restoreRealDebridBatchProgress(
    download: Download,
    batchState: JsBatchState
  ) {
    download.files = this.readLocalFileProgress(
      batchState.savePath,
      batchState.entries.map((entry) => ({
        index: entry.fileIndex!,
        path: entry.filename,
        size: entry.size,
      }))
    ).map((file, index) => {
      if (!file.completed) return file;
      const identity = getResourceIdentityState(
        path.join(batchState.savePath, file.path),
        this.getBatchResourceId(batchState, batchState.entries[index])
      );
      if (identity === "changed") {
        throw new Error(
          "The completed download file changed. Keeping the saved file."
        );
      }
      // Without a matching completion receipt, the downloader must verify saved bytes.
      return { ...file, completed: identity === "complete" };
    });
    while (batchState.currentIndex < batchState.entries.length - 1) {
      const file = download.files[batchState.currentIndex];
      if (!file.completed) break;
      batchState.completedBytes += file.size;
      batchState.currentIndex++;
    }
  }

  private static async startBatchDownload(
    download: Download,
    downloadId: string,
    myGeneration: number,
    signal: AbortSignal
  ) {
    let batchState: JsBatchState;
    switch (download.downloader) {
      case Downloader.TorBox:
        batchState = await this.prepareTorBoxBatch(download, downloadId);
        break;
      case Downloader.AllDebrid:
        batchState = await this.prepareAllDebridBatch(download, downloadId);
        break;
      default:
        batchState = await this.prepareRealDebridBatch(
          download,
          downloadId,
          myGeneration,
          signal
        );
    }
    if (!this.isCurrentStart(downloadId, myGeneration, signal)) {
      logger.log(
        "[DownloadManager] Download was superseded during preparation; aborting start"
      );
      return;
    }

    if (batchState.provider === "torBox") {
      const record = await downloadsSublevel.get(downloadId);
      if (!record || !this.isCurrentStart(downloadId, myGeneration, signal)) {
        return;
      }
      await this.persistDownloadRecord(downloadId, {
        ...record,
        files: download.files,
      });
      if (!this.isCurrentStart(downloadId, myGeneration, signal)) return;
    }
    if (
      batchState.provider === "torBox" &&
      batchState.entries.every((entry) => !entry.isZip)
    ) {
      this.startTorBoxFiles(download, batchState, myGeneration);
      return;
    }
    batchState.generation = myGeneration;
    const session = this.getSession(downloadId);
    const downloader = new JsHttpDownloader();
    if (session) {
      session.batch = batchState;
      session.downloader = downloader;
      session.isPreparing = false;
    }
    downloader.setMaxDownloadSpeedBytesPerSecond(
      this.maxDownloadSpeedBytesPerSecond
    );
    void this.runJsBatch(downloadId);
  }

  private static startTorBoxFiles(
    download: Download,
    batch: JsBatchState,
    generation: number
  ): void {
    const downloader = new TorBoxBatchDownloader(
      download.files!,
      batch.rootFolderName ?? batch.entries[0]?.filename ?? "",
      (index, signal) =>
        TorBoxClient.requestLink(
          batch.torrentId!,
          batch.entries[index].fileId!,
          signal
        ),
      (index, url) => {
        const entry = batch.entries[index];
        this.assertSafeBatchPath(batch.savePath, entry.filename);
        return this.getBatchDownloadOptions(batch, entry, url);
      }
    );
    const session = this.getSession(batch.downloadId);
    if (session) {
      session.downloader = downloader;
      session.batch = batch;
      session.isPreparing = false;
    }
    downloader.setMaxDownloadSpeedBytesPerSecond(
      this.maxDownloadSpeedBytesPerSecond
    );
    void downloader.startDownload().catch(async (error) => {
      const session = this.getSession(batch.downloadId);
      if (
        session?.generation !== generation ||
        session.downloader !== downloader
      )
        return;
      try {
        await this.persistPausedJsProgress(
          batch.downloadId,
          () =>
            this.sessions.get(batch.downloadId) === session &&
            session.downloader === downloader
        );
      } catch (persistError) {
        logger.error(
          "[DownloadManager] Failed to save batch progress",
          persistError
        );
      }
      await this.reportRuntimeDownloadError(
        batch.downloadId,
        error,
        generation
      );
    });
  }

  private static async startSingleJsDownload(
    download: Download,
    downloadId: string,
    myGeneration: number,
    signal: AbortSignal,
    preparedOptions: JsDownloadOptions | null
  ) {
    const session = this.getSession(downloadId);
    if (session) session.batch = null;
    const options =
      preparedOptions ?? (await this.getJsDownloadOptions(download));

    if (!options) {
      throw new Error("Failed to get download options for JS downloader");
    }

    if (!this.isCurrentStart(downloadId, myGeneration, signal)) {
      logger.log(
        "[DownloadManager] Download was superseded during preparation; aborting start"
      );
      return;
    }

    const downloader = new JsHttpDownloader();
    if (session) {
      session.downloader = downloader;
      session.batch = null;
      session.isPreparing = false;
    }
    downloader.setMaxDownloadSpeedBytesPerSecond(
      this.maxDownloadSpeedBytesPerSecond
    );

    this.logResolvedUrl(options.url);
    downloader
      .startDownload({ ...options, resourceId: download.uri })
      .catch((err) =>
        this.reportRuntimeDownloadError(downloadId, err, myGeneration)
      );
  }

  private static async reportRuntimeDownloadError(
    downloadId: string,
    error: unknown,
    generation: number
  ) {
    try {
      await this.handleRuntimeDownloadError(downloadId, error, generation);
    } catch (error_) {
      logger.error(
        `[DownloadManager] Failed to handle download error for ${downloadId}`,
        error_
      );
    }
  }

  private static async startHttpDownload(
    download: Download,
    downloadId: string,
    myGeneration: number,
    signal: AbortSignal
  ) {
    logger.log("[DownloadManager] Using JS HTTP downloader");
    const preparedOptions = this.takePreparedJsDownload(download, downloadId);
    const session = this.getSession(downloadId);
    if (session) {
      session.isPreparing = true;
    }
    try {
      if (this.isBatchDownload(download)) {
        await this.startBatchDownload(
          download,
          downloadId,
          myGeneration,
          signal
        );
      } else {
        await this.startSingleJsDownload(
          download,
          downloadId,
          myGeneration,
          signal,
          preparedOptions
        );
      }
      // An aborted manifest lookup can return without ever creating a downloader.
      if (session?.isPreparing) signal.throwIfAborted();
    } catch (error) {
      this.cleanupFailedHttpStart(downloadId, myGeneration, session);
      throw error;
    }
  }

  private static isBatchDownload(download: Download) {
    return (
      download.downloader === Downloader.AllDebrid ||
      download.downloader === Downloader.TorBox ||
      (download.downloader === Downloader.RealDebrid &&
        download.uri.startsWith("magnet:"))
    );
  }

  private static cleanupFailedHttpStart(
    downloadId: string,
    generation: number,
    session: DownloadSession | null
  ) {
    if (session) {
      if (session.generation !== generation) return;
      session.isPreparing = false;
      this.clearSession(downloadId, session);
    }
  }

  private static async cancelStaleTorrent(downloadId: string) {
    const wasReplacedBySameGame =
      this.sessions.get(downloadId)?.torrent === true;

    if (!wasReplacedBySameGame) {
      await TorrentService.call("action", {
        action: "cancel",
        game_id: downloadId,
      }).catch((error) => {
        logger.error(
          "[DownloadManager] Failed to cancel stale torrent download",
          error
        );
      });
    }
  }

  private static async startTorrentSession(
    download: Download,
    downloadId: string,
    session: DownloadSession
  ) {
    logger.log("[DownloadManager] Using native libtorrent downloader session");
    const payload = await this.getDownloadPayload(download);
    const isSelectiveTorrentStart =
      download.downloader === Downloader.Torrent &&
      Array.isArray(download.fileIndices) &&
      download.fileIndices.length > 0;
    if (
      this.sessions.get(downloadId) !== session ||
      session.preparationController.signal.aborted
    )
      return;

    try {
      await TorrentService.call("action", payload, {
        timeout: isSelectiveTorrentStart
          ? SELECTIVE_TORRENT_START_TIMEOUT_MS
          : TORRENT_START_TIMEOUT_MS,
      });
      if (
        this.sessions.get(downloadId) !== session ||
        session.preparationController.signal.aborted
      ) {
        await this.cancelStaleTorrent(downloadId);
        return;
      }
      session.isPreparing = false;
    } catch (error) {
      if (this.sessions.get(downloadId) === session) {
        session.isPreparing = false;
        this.clearSession(downloadId, session);
      }
      throw error;
    }
  }

  static async startDownload(download: Download, externalSignal?: AbortSignal) {
    externalSignal?.throwIfAborted();
    const isHttp = this.isHttpDownloader(download.downloader);
    const downloadId = levelKeys.game(download.shop, download.objectId);

    this.queueHeldForDiskSpace = false;

    if (isHttp) {
      const previousSession = this.getSession(downloadId);
      if (previousSession) {
        previousSession.preparationController.abort();
        if (previousSession.downloader) {
          previousSession.downloader.pauseDownload();
          await previousSession.downloader.waitForIdle();
          previousSession.downloader.cancelDownload();
        }
        this.clearSession(downloadId, previousSession);
      }

      const preparationController = new AbortController();
      const session = this.createSession(downloadId, preparationController);
      const signal = externalSignal
        ? AbortSignal.any([externalSignal, preparationController.signal])
        : preparationController.signal;

      await this.startHttpDownload(
        download,
        downloadId,
        session.generation,
        signal
      );
      this.scheduleBandwidthRebalance(true);
      return;
    }

    if (download.downloader === Downloader.Epic) {
      const previousSession = this.getSession(downloadId);
      if (previousSession) {
        previousSession.preparationController.abort();
        if (previousSession.epic)
          await getEpicDownloadService().stop(downloadId);
        else if (previousSession.downloader) {
          previousSession.downloader.pauseDownload();
          await previousSession.downloader.waitForIdle();
          previousSession.downloader.cancelDownload();
        }
        this.clearSession(downloadId, previousSession);
      }

      const preparationController = new AbortController();
      const session = this.createSession(downloadId, preparationController);
      session.epic = true;
      const signal = externalSignal
        ? AbortSignal.any([externalSignal, preparationController.signal])
        : preparationController.signal;

      try {
        await getEpicDownloadService().startRuntime(
          download,
          (error) => {
            if (
              this.sessions.get(downloadId) !== session ||
              session.generation !== this.sessionGenerations.get(downloadId) ||
              session.preparationController.signal.aborted
            )
              return;
            void this.handleRuntimeDownloadError(
              downloadId,
              error,
              session.generation
            ).catch((failure) =>
              logger.error(
                "[DownloadManager] Failed to handle Epic download error",
                failure
              )
            );
          },
          () => this.sessions.get(downloadId) === session && !signal.aborted
        );
        if (this.sessions.get(downloadId) === session && !signal.aborted)
          session.isPreparing = false;
      } catch (error) {
        if (this.sessions.get(downloadId) === session) {
          await getEpicDownloadService().stop(downloadId);
          const current = await downloadsSublevel.get(downloadId);
          if (
            current?.downloader === Downloader.Epic &&
            current.timestamp === download.timestamp &&
            current.epic
          ) {
            await this.persistDownloadRecord(downloadId, {
              ...current,
              status: "paused",
              queued: false,
              pinnedToHero: false,
              epic: { ...current.epic, error: epicManagedErrorCode(error) },
            });
            WindowManager.sendDownloadsUpdated();
          }
          this.clearSession(downloadId, session);
        }
        throw error;
      }
      return;
    }

    if (download.downloader === Downloader.Torrent) {
      const previousSession = this.getSession(downloadId);
      if (previousSession) {
        previousSession.preparationController.abort();
        await TorrentService.call("action", {
          action: "cancel",
          game_id: downloadId,
        });
        this.clearSession(downloadId, previousSession);
      }
      const session = this.createSession(downloadId, new AbortController());
      session.torrent = true;
      await this.startTorrentSession(download, downloadId, session);
      this.scheduleBandwidthRebalance(true);
      return;
    }

    throw new Error("Unsupported downloader: " + download.downloader);
  }
}
