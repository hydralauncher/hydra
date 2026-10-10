import fs from "node:fs";
import type { FileHandle } from "node:fs/promises";
import path from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { logger } from "../logger";
import {
  applySkip,
  chooseDownloadOutputPath,
  clampProgress,
  computeFileSize,
  isRetryableDownloadError,
  isRetryableHttpStatus,
  MAX_BUDGET_RESETS,
  MAX_RESTARTS_FROM_ZERO,
  parseRetryAfterMs,
  PROGRESS_RESET_THRESHOLD_BYTES,
  resolveResumeAction,
  shouldResetRetryBudget,
  stallDetected,
  verifyResumePrefixChunk,
} from "./js-http-downloader-helpers";
import {
  downloadParallelRanges,
  getRangeResumeCapability,
  getRangeTotal,
  getStrongRangeValidator,
  PARALLEL_RANGE_SIZE,
  ParallelRangeUnsupportedError,
  ParallelRangeHttpStatusError,
  shouldDowngradeParallelRanges,
} from "./parallel-range-download";

import {
  getRangeDownloadedBytes,
  missingRanges,
  rangeResourceId,
  readRangeState,
  removeRangeState,
  savedRangeBytes,
  type RangeDownloadState,
} from "./range-download-state";

export interface JsHttpDownloaderStatus {
  folderName: string;
  fileSize: number;
  progress: number;
  downloadSpeed: number;
  numPeers: number;
  numSeeds: number;
  status: "active" | "paused" | "complete" | "error";
  bytesDownloaded: number;
  isReconnecting: boolean;
  isRecovering: boolean;
  recoveryProgress: number;
  resumeCapability?: "unknown" | "supported" | "unsupported";
}

export interface JsHttpDownloaderOptions {
  url: string;
  refreshUrl?: () => Promise<string>;
  savePath: string;
  filename?: string;
  headers?: Record<string, string>;
  allowParallelRanges?: boolean;
  parallelRangeSize?: number;
  probeUnboundedRange?: boolean;
  parallelRangeConnections?: number;
  maxParallelRanges?: number;
  preserveFilename?: boolean;
  allowResume?: boolean;
  verifyResumePrefix?: boolean;
  resourceId?: string;
  expectedSize?: number;
  requireRangeResume?: boolean;
}

const MAX_RETRY_ATTEMPTS = 10;
const MAX_STATUS_RETRY_ATTEMPTS = 4;
const MAX_RETRY_AFTER_MS = 20000;
const INITIAL_RETRY_DELAY_MS = 1000;
const MAX_RETRY_DELAY_MS = 15000;
const STALL_TIMEOUT_MS = 30000;
const STALL_CHECK_INTERVAL_MS = 2000;
const RECONNECT_RETRY_DELAY_MS = 500;
const RESUME_OVERLAP_BYTES = 64 * 1024;
export const DEFAULT_DOWNLOAD_USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:144.0) Gecko/20100101 Firefox/144.0";

class HttpDownloadStatusError extends Error {
  constructor(
    public readonly statusCode: number,
    public readonly retryable = false,
    public readonly retryAfterMs: number | null = null
  ) {
    super(`The download link is not available (HTTP ${statusCode}).`);
    this.name = "HttpDownloadStatusError";
  }
}

export class JsHttpDownloader {
  private abortController: AbortController | null = null;
  private writeStream: fs.WriteStream | null = null;
  private currentOptions: JsHttpDownloaderOptions | null = null;
  private resolvedFilename: string | null = null;
  private outputFilePath: string | null = null;

  private bytesDownloaded = 0;
  private fileSize = 0;
  private downloadSpeed = 0;
  private status: "active" | "paused" | "complete" | "error" = "paused";
  private folderName = "";
  private lastSpeedUpdate = Date.now();
  private bytesAtLastSpeedUpdate = 0;
  private isDownloading = false;

  private retryCount = 0;
  private statusRetryCount = 0;
  private budgetResets = 0;
  private attemptBytesReceived = 0;
  private restartCount = 0;
  private pendingReadSince: number | null = null;
  private stallCheckInterval: NodeJS.Timeout | null = null;
  private isPaused = false;
  private isStallRetry = false;
  private isReconnecting = false;
  private isReconnectRetry = false;
  private isRecovering = false;
  private recoverBytesTotal = 0;
  private recoverBytesDone = 0;
  private recoverSpeedLastUpdate = Date.now();
  private recoverBytesAtLastUpdate = 0;
  private maxDownloadSpeedBytesPerSecond: number | null = null;
  private throttleWindowStart = Date.now();
  private bytesTransferredInThrottleWindow = 0;
  private parallelRangesDisabled = false;
  private parallelRangeFailures = 0;
  private resourceValidator: string | null = null;
  private savedRangeState: RangeDownloadState | null = null;
  private verifyUnvalidatedResumeOverlap = false;
  private resumeCapability: "unknown" | "supported" | "unsupported" = "unknown";
  private readonly pendingRangeReads = new Map<number, number>();
  private urlRefreshAttempted = false;
  private activeRun: Promise<void> | null = null;

  setMaxDownloadSpeedBytesPerSecond(limit: number | null): void {
    if (typeof limit !== "number" || !Number.isFinite(limit) || limit <= 0) {
      this.maxDownloadSpeedBytesPerSecond = null;
    } else {
      this.maxDownloadSpeedBytesPerSecond = Math.floor(limit);
    }

    this.resetThrottleWindow();
  }

  async startDownload(options: JsHttpDownloaderOptions): Promise<void> {
    if (this.isDownloading) {
      logger.log(
        "[JsHttpDownloader] Download already in progress, resuming..."
      );
      return this.waitForIdle();
    }

    this.currentOptions = options;
    this.isPaused = false;
    this.retryCount = 0;
    this.statusRetryCount = 0;
    this.budgetResets = 0;
    this.attemptBytesReceived = 0;
    this.restartCount = 0;
    this.isStallRetry = false;
    this.isReconnecting = false;
    this.isReconnectRetry = false;
    this.resetRecoveryState();
    this.fileSize = 0;
    this.resolvedFilename = null;
    this.pendingReadSince = null;
    this.parallelRangesDisabled = false;
    this.parallelRangeFailures = 0;
    this.resourceValidator = null;
    this.savedRangeState = null;
    this.verifyUnvalidatedResumeOverlap = false;
    this.resumeCapability = "unknown";
    this.pendingRangeReads.clear();
    this.urlRefreshAttempted = false;
    this.resetThrottleWindow();
    if (options.expectedSize === 0) {
      const output = this.prepareDownloadPath(
        options.savePath,
        options.filename,
        options.url
      );
      if (this.bytesDownloaded !== 0)
        throw new Error(
          "The empty file has existing data. Keeping the saved file."
        );
      fs.writeFileSync(output.filePath, "");
      this.markComplete();
      return;
    }
    await this.runDownload();
  }

  private async runDownload(): Promise<void> {
    const run = this.startDownloadWithRetry();
    this.activeRun = run;
    try {
      await run;
    } finally {
      if (this.activeRun === run) this.activeRun = null;
    }
  }

  async waitForIdle(): Promise<void> {
    await this.activeRun?.catch(() => undefined);
  }

  private async startDownloadWithRetry(): Promise<void> {
    if (!this.currentOptions) return;

    try {
      while (!this.isPaused) {
        if (!this.currentOptions) return;

        this.abortController = new AbortController();
        this.status = "active";
        this.isDownloading = true;
        this.isStallRetry = false;
        this.pendingReadSince = null;
        this.attemptBytesReceived = 0;

        try {
          const { url, savePath, filename, headers = {} } = this.currentOptions;
          const { filePath, startByte, usedFallback } =
            this.prepareDownloadPath(savePath, filename, url);
          this.verifyUnvalidatedResumeOverlap =
            startByte > 0 &&
            !this.resourceValidator &&
            !this.savedRangeState &&
            this.currentOptions.allowParallelRanges !== false;
          const rangeStart = this.getResumeRangeStart(startByte);
          const requestHeaders = this.buildRequestHeaders(headers, rangeStart);

          this.startStallDetection();
          await this.executeDownload(
            url,
            requestHeaders,
            filePath,
            startByte,
            savePath,
            usedFallback
          );
          break;
        } catch (err) {
          this.abortController?.abort();
          this.restoreSavedByteCount();
          const shouldRetry = await this.handleDownloadErrorWithRetry(
            err as Error
          );
          if (!shouldRetry) {
            break;
          }
        } finally {
          this.stopStallDetection();
          this.cleanupResources();
        }
      }
    } finally {
      this.isDownloading = false;
    }
  }

  private restoreSavedByteCount(): void {
    if (this.outputFilePath) {
      try {
        this.bytesDownloaded = getRangeDownloadedBytes(this.outputFilePath);
      } catch {
        /* An invalid map must preserve the original error. */
      }
    }
  }

  private startStallDetection(): void {
    this.stopStallDetection();
    this.stallCheckInterval = setInterval(() => {
      if (this.status !== "active" || this.isPaused || this.isStallRetry) {
        return;
      }

      const pendingSince = Math.min(
        this.pendingReadSince ?? Infinity,
        ...this.pendingRangeReads.values()
      );
      if (stallDetected(pendingSince, Date.now(), STALL_TIMEOUT_MS)) {
        const blockedSeconds = Math.round((Date.now() - pendingSince) / 1000);
        logger.log(
          `[JsHttpDownloader] Read blocked for ${blockedSeconds}s with no data, triggering retry`
        );
        this.triggerRetry();
      }
    }, STALL_CHECK_INTERVAL_MS);
  }

  private stopStallDetection(): void {
    if (this.stallCheckInterval) {
      clearInterval(this.stallCheckInterval);
      this.stallCheckInterval = null;
    }
  }

  private triggerRetry(): void {
    this.isStallRetry = true;
    if (this.abortController) {
      this.abortController.abort();
    }
  }

  private async handleDownloadErrorWithRetry(err: Error): Promise<boolean> {
    err = this.normalizeRangeError(err);

    if (this.isPaused) {
      logger.log("[JsHttpDownloader] Download paused/cancelled by user");
      this.status = "paused";
      return false;
    }

    const wasStallRetry = this.isStallRetry;
    const wasReconnect = this.isReconnectRetry;
    this.isReconnectRetry = false;
    const isAbortError = err.name === "AbortError";
    const isRetryable =
      wasStallRetry || wasReconnect || isRetryableDownloadError(err);
    const transientStatus =
      err instanceof HttpDownloadStatusError && err.retryable;

    this.maybeResetRetryBudget();
    if (
      err instanceof HttpDownloadStatusError &&
      [401, 403, 404].includes(err.statusCode)
    ) {
      const refresh = await this.refreshUrlOnRetry();
      if (refresh === "paused") return false;
      if (refresh === "refreshed") return true;
    }

    if (transientStatus) {
      return this.handleTransientStatusError(err as HttpDownloadStatusError);
    }

    if (wasReconnect) {
      logger.log(
        `[JsHttpDownloader] Reconnecting after a network change; resuming in ${RECONNECT_RETRY_DELAY_MS}ms`
      );
      await this.sleep(RECONNECT_RETRY_DELAY_MS);
      return !this.isPaused;
    }

    if (isRetryable && this.retryCount < MAX_RETRY_ATTEMPTS) {
      return this.retryAfterError(err, wasStallRetry);
    }

    if (wasStallRetry) {
      this.handleDownloadError(
        new Error(
          "Download stalled repeatedly and could not be resumed after multiple retries."
        )
      );
      return false;
    }

    if (isAbortError) {
      logger.log("[JsHttpDownloader] Download aborted");
      this.status = "paused";
      return false;
    }

    this.handleDownloadError(err);
    return false;
  }

  private normalizeRangeError(err: Error): Error {
    if (err instanceof ParallelRangeHttpStatusError) {
      err = new HttpDownloadStatusError(
        err.statusCode,
        isRetryableHttpStatus(err.statusCode),
        parseRetryAfterMs(err.retryAfter, Date.now())
      );
    }
    if (err instanceof ParallelRangeUnsupportedError) {
      this.parallelRangesDisabled = true;
      logger.log(
        "[JsHttpDownloader] Server stopped honoring byte ranges; retrying with one connection"
      );
    }
    return err;
  }

  private async refreshUrlOnRetry(): Promise<
    "refreshed" | "paused" | "failed"
  > {
    if (this.urlRefreshAttempted || !this.currentOptions?.refreshUrl) {
      return "failed";
    }
    this.urlRefreshAttempted = true;
    try {
      const freshUrl = await this.currentOptions.refreshUrl();
      if (this.isPaused) return "paused";
      if (freshUrl) {
        this.currentOptions = { ...this.currentOptions, url: freshUrl };
        logger.log("[JsHttpDownloader] Refreshed download link for retry");
        return "refreshed";
      }
    } catch {
      logger.warn(
        "[JsHttpDownloader] Could not refresh download link for retry"
      );
    }
    return "failed";
  }

  private async retryAfterError(
    err: Error,
    wasStallRetry: boolean
  ): Promise<boolean> {
    this.retryCount++;
    this.isReconnecting = true;
    this.downloadSpeed = 0;
    if ((await this.refreshUrlOnRetry()) === "paused") return false;

    const delay = Math.min(
      INITIAL_RETRY_DELAY_MS * Math.pow(2, this.retryCount - 1),
      MAX_RETRY_DELAY_MS
    );
    const causeCode = (err.cause as NodeJS.ErrnoException | undefined)?.code;
    let reason = err.message;
    if (wasStallRetry) reason = "stall detected";
    else if (causeCode) reason += ` (${causeCode})`;
    logger.log(
      `[JsHttpDownloader] Retryable error (${reason}). ` +
        `Retry ${this.retryCount}/${MAX_RETRY_ATTEMPTS} in ${delay}ms`
    );

    await this.sleep(delay);
    return !this.isPaused;
  }

  private maybeResetRetryBudget(): void {
    if (
      shouldResetRetryBudget(
        this.attemptBytesReceived,
        this.budgetResets,
        PROGRESS_RESET_THRESHOLD_BYTES,
        MAX_BUDGET_RESETS
      )
    ) {
      logger.log(
        "[JsHttpDownloader] Data is flowing again; resetting retry budget"
      );
      this.retryCount = 0;
      this.statusRetryCount = 0;
      this.budgetResets += 1;
    }
  }

  private async handleTransientStatusError(
    statusError: HttpDownloadStatusError
  ): Promise<boolean> {
    if (this.statusRetryCount >= MAX_STATUS_RETRY_ATTEMPTS) {
      this.handleDownloadError(
        new Error(
          `The download server is rate-limiting or temporarily unavailable (HTTP ${statusError.statusCode}). Try again later or use another source.`
        )
      );
      return false;
    }

    this.statusRetryCount++;
    const backoff = Math.min(
      INITIAL_RETRY_DELAY_MS * Math.pow(2, this.statusRetryCount - 1),
      MAX_RETRY_DELAY_MS
    );
    const delay =
      statusError.retryAfterMs === null
        ? backoff
        : Math.min(statusError.retryAfterMs, MAX_RETRY_AFTER_MS);
    logger.log(
      `[JsHttpDownloader] Server unavailable (HTTP ${statusError.statusCode}). ` +
        `Retry ${this.statusRetryCount}/${MAX_STATUS_RETRY_ATTEMPTS} in ${delay}ms`
    );
    await this.sleep(delay);
    return !this.isPaused;
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  private resetThrottleWindow(): void {
    this.throttleWindowStart = Date.now();
    this.bytesTransferredInThrottleWindow = 0;
  }

  private async applyThrottle(chunkSize: number): Promise<void> {
    await new Promise<void>((resolve) => {
      const checkBudget = () => {
        if (this.isPaused || this.abortController?.signal.aborted) {
          resolve();
          return;
        }
        const limit = this.maxDownloadSpeedBytesPerSecond;
        if (!limit) {
          resolve();
          return;
        }
        const elapsed = Date.now() - this.throttleWindowStart;
        const required =
          ((this.bytesTransferredInThrottleWindow + chunkSize) * 1000) / limit;
        if (elapsed >= required) {
          this.bytesTransferredInThrottleWindow += chunkSize;
          resolve();
          return;
        }
        // Keep one timer per worker while sharing the transfer budget.
        setTimeout(checkBudget, Math.min(100, Math.max(1, required - elapsed)));
      };
      checkBudget();
    });
  }

  private prepareDownloadPath(
    savePath: string,
    filename: string | undefined,
    url: string
  ): { filePath: string; startByte: number; usedFallback: boolean } {
    const extractedFilename =
      this.resolvedFilename || filename || this.extractFilename(url);
    const usedFallback = !extractedFilename;
    const resolvedFilename = extractedFilename || "download";
    this.folderName = resolvedFilename;
    const filePath = path.join(savePath, resolvedFilename);
    this.outputFilePath = filePath;

    if (!fs.existsSync(savePath)) {
      fs.mkdirSync(savePath, { recursive: true });
    }

    const targetDir = path.dirname(filePath);
    if (!fs.existsSync(targetDir)) {
      fs.mkdirSync(targetDir, { recursive: true });
    }

    let startByte = 0;
    if (this.currentOptions?.allowResume !== false && fs.existsSync(filePath)) {
      const stats = fs.statSync(filePath);
      startByte = stats.size;
      logger.log(`[JsHttpDownloader] Resuming download from byte ${startByte}`);
    }

    this.savedRangeState =
      this.currentOptions?.allowResume === false
        ? null
        : readRangeState(filePath);
    if (this.currentOptions?.allowResume === false) removeRangeState(filePath);
    if (this.savedRangeState) {
      if (
        this.savedRangeState.resourceId !==
        rangeResourceId(this.currentOptions?.resourceId)
      ) {
        throw new Error(
          "The saved file belongs to a different download. Keeping the partial file."
        );
      }
      this.resourceValidator = this.savedRangeState.validator;
      this.fileSize = this.savedRangeState.total;
      startByte = missingRanges(this.savedRangeState)[0]?.[0] ?? this.fileSize;
      this.bytesDownloaded = savedRangeBytes(this.savedRangeState);
    } else {
      this.bytesDownloaded = startByte;
    }
    this.resetSpeedTracking();
    return { filePath, startByte, usedFallback };
  }

  private buildRequestHeaders(
    headers: Record<string, string>,
    startByte: number
  ): Record<string, string> {
    const requestHeaders: Record<string, string> = { ...headers };

    const hasUserAgentHeader = Object.keys(requestHeaders).some(
      (key) => key.toLowerCase() === "user-agent"
    );

    if (!hasUserAgentHeader) {
      requestHeaders["User-Agent"] = DEFAULT_DOWNLOAD_USER_AGENT;
    }

    const hasAcceptEncoding = Object.keys(requestHeaders).some(
      (key) => key.toLowerCase() === "accept-encoding"
    );

    if (!hasAcceptEncoding) {
      requestHeaders["Accept-Encoding"] = "identity";
    }

    if (
      startByte > 0 ||
      this.currentOptions?.verifyResumePrefix ||
      this.verifyUnvalidatedResumeOverlap
    ) {
      requestHeaders["Range"] = `bytes=${startByte}-`;
    }
    if (startByte > 0 && this.resourceValidator) {
      requestHeaders["If-Range"] = this.resourceValidator;
    }
    return requestHeaders;
  }

  private shouldVerifyResumePrefix(): boolean {
    return (
      !this.savedRangeState &&
      Boolean(
        this.currentOptions?.verifyResumePrefix ||
          this.resourceValidator ||
          this.verifyUnvalidatedResumeOverlap
      )
    );
  }

  private getResumeRangeStart(startByte: number): number {
    return this.shouldVerifyResumePrefix() && startByte > 0
      ? Math.max(0, startByte - RESUME_OVERLAP_BYTES)
      : startByte;
  }

  private trackResumeCapability(
    response: Response,
    requestedRange: string | undefined,
    ifRange?: string
  ): void {
    const capability = getRangeResumeCapability(
      response,
      requestedRange,
      ifRange
    );
    if (capability !== "unknown") this.resumeCapability = capability;
  }

  private resetSpeedTracking(): void {
    this.lastSpeedUpdate = Date.now();
    this.bytesAtLastSpeedUpdate = this.bytesDownloaded;
    this.downloadSpeed = 0;
  }

  private parseFileSize(response: Response, startByte: number): void {
    const size = computeFileSize({
      status: response.status,
      contentRange: response.headers.get("content-range"),
      contentLength: response.headers.get("content-length"),
      startByte,
    });

    if (size !== null) {
      this.fileSize = size;
    }
  }

  private parseTotalSizeFrom416(response: Response): number | null {
    const contentRange = response.headers.get("content-range");
    if (!contentRange) return null;

    const match = /bytes\s+\*\/(\d+)/i.exec(contentRange);
    if (!match) return null;

    const total = Number.parseInt(match[1], 10);
    return Number.isFinite(total) && total > 0 ? total : null;
  }

  private parseContentRangeStart(response: Response): number | null {
    const contentRange = response.headers.get("content-range");
    if (!contentRange) return null;

    const match = /bytes\s+(\d+)-/i.exec(contentRange);
    if (!match) return null;

    const start = Number.parseInt(match[1], 10);
    return Number.isFinite(start) ? start : null;
  }

  private async executeDownload(
    url: string,
    requestHeaders: Record<string, string>,
    filePath: string,
    startByte: number,
    savePath: string,
    usedFallback: boolean
  ): Promise<void> {
    if (
      this.savedRangeState &&
      missingRanges(this.savedRangeState).length === 0
    ) {
      removeRangeState(filePath);
      this.bytesDownloaded = this.savedRangeState.total;
      this.savedRangeState = null;
      this.markComplete();
      return;
    }
    let response: Response;
    let fullRangeResponse = false;
    if (
      this.savedRangeState ||
      (!this.parallelRangesDisabled &&
        this.currentOptions?.allowParallelRanges !== false &&
        !this.verifyUnvalidatedResumeOverlap &&
        !(startByte > 0 && this.currentOptions?.verifyResumePrefix))
    ) {
      const rangeSize = this.parallelRangesDisabled
        ? Number.MAX_SAFE_INTEGER
        : (this.currentOptions?.parallelRangeSize ?? PARALLEL_RANGE_SIZE);
      const firstGap = this.savedRangeState
        ? missingRanges(this.savedRangeState)[0]
        : null;
      const unboundedProbe =
        this.currentOptions?.probeUnboundedRange && !this.savedRangeState;
      const gapEnd = firstGap ? firstGap[1] - 1 : Number.MAX_SAFE_INTEGER;
      const rangeEnd = unboundedProbe
        ? Number.MAX_SAFE_INTEGER
        : Math.min(startByte + rangeSize - 1, gapEnd);
      const requestedRange = unboundedProbe
        ? `bytes=${startByte}-`
        : `bytes=${startByte}-${rangeEnd}`;
      response = await this.fetchWithStallTracking(url, {
        headers: { ...requestHeaders, Range: requestedRange },
        signal: this.abortController?.signal,
      });
      this.trackResumeCapability(
        response,
        requestedRange,
        requestHeaders["If-Range"]
      );
      const total = getRangeTotal(response, startByte, rangeEnd);
      const validator = getStrongRangeValidator(response);
      fullRangeResponse = total !== null && rangeEnd >= total - 1;
      if (
        this.savedRangeState &&
        (total !== this.savedRangeState.total ||
          validator !== this.savedRangeState.validator)
      ) {
        await response.body?.cancel();
        if (response.status >= 400) {
          throw new HttpDownloadStatusError(
            response.status,
            isRetryableHttpStatus(response.status),
            parseRetryAfterMs(response.headers.get("retry-after"), Date.now())
          );
        }
        throw new Error(
          "The server cannot safely resume the saved byte ranges. Keeping the partial file."
        );
      }
      if (
        total !== null &&
        validator !== null &&
        (startByte === 0 || this.resourceValidator === validator) &&
        (this.savedRangeState || total - startByte >= rangeSize * 2) &&
        !/^(text\/html|application\/xhtml)/i.test(
          response.headers.get("content-type") ?? ""
        )
      ) {
        if (
          this.currentOptions?.expectedSize !== undefined &&
          total !== this.currentOptions.expectedSize
        ) {
          await response.body?.cancel();
          throw new Error(
            "The download server returned a different file size. Keeping the partial file."
          );
        }
        if (unboundedProbe) {
          await response.body?.cancel();
          response = await this.fetchWithStallTracking(url, {
            headers: {
              ...requestHeaders,
              Range: `bytes=${startByte}-${Math.min(startByte + rangeSize - 1, total - 1)}`,
            },
            signal: this.abortController?.signal,
          });
          if (
            getRangeTotal(
              response,
              startByte,
              Math.min(startByte + rangeSize - 1, total - 1)
            ) !== total ||
            getStrongRangeValidator(response) !== validator
          ) {
            await response.body?.cancel();
            if (response.status >= 400)
              throw new HttpDownloadStatusError(
                response.status,
                isRetryableHttpStatus(response.status),
                parseRetryAfterMs(
                  response.headers.get("retry-after"),
                  Date.now()
                )
              );
            throw new Error(
              "The download resource changed during range preparation. Keeping the partial file."
            );
          }
        }
        const actualFilePath = this.resolveOutputPath(
          response,
          filePath,
          savePath,
          usedFallback,
          startByte === 0 && !this.savedRangeState
        );
        if (startByte === 0 && !this.savedRangeState)
          fs.writeFileSync(actualFilePath, "");
        this.fileSize = total;
        this.resourceValidator = validator;
        logger.log(
          `[JsHttpDownloader] Downloading ${total} bytes with saved byte ranges`
        );
        const signal = this.abortController!.signal;
        let complete: boolean;
        const previousBytes = this.bytesDownloaded;
        try {
          complete = await downloadParallelRanges({
            url,
            headers: requestHeaders,
            firstResponse: response,
            filePath: actualFilePath,
            startByte,
            total,
            rangeSize,
            resourceId: this.currentOptions?.resourceId,
            connectionCount: this.parallelRangesDisabled
              ? 1
              : this.currentOptions?.parallelRangeConnections,
            maxRanges: this.parallelRangesDisabled
              ? Infinity
              : this.currentOptions?.maxParallelRanges,
            signal,
            abort: () => this.abortController?.abort(),
            beforeChunk: (length) => this.applyThrottle(length),
            afterChunk: (length) => {
              this.urlRefreshAttempted = false;
              this.attemptBytesReceived += length;
              this.bytesDownloaded += length;
              this.isReconnecting = false;
              this.updateSpeed();
            },
            onReadPending: (offset, pending) => {
              if (pending) this.pendingRangeReads.set(offset, Date.now());
              else this.pendingRangeReads.delete(offset);
            },
          });
        } catch (error) {
          if (
            !this.isPaused &&
            !this.isReconnectRetry &&
            !(error instanceof ParallelRangeUnsupportedError) &&
            (this.isStallRetry || isRetryableDownloadError(error))
          ) {
            this.parallelRangeFailures++;
            if (
              shouldDowngradeParallelRanges(error, this.parallelRangeFailures)
            )
              this.parallelRangesDisabled = true;
          }
          const committed = getRangeDownloadedBytes(actualFilePath);
          this.bytesDownloaded = committed;
          this.savedRangeState = readRangeState(actualFilePath);
          this.attemptBytesReceived = Math.max(0, committed - previousBytes);
          this.resetSpeedTracking();
          throw error;
        } finally {
          this.pendingRangeReads.clear();
        }
        signal.throwIfAborted();
        this.savedRangeState = readRangeState(actualFilePath);
        if (!complete) {
          this.parallelRangesDisabled = true;
          const nextByte = missingRanges(this.savedRangeState!)[0][0];
          this.bytesDownloaded = savedRangeBytes(this.savedRangeState!);
          this.resetSpeedTracking();
          await this.executeDownload(
            url,
            this.buildRequestHeaders(requestHeaders, nextByte),
            actualFilePath,
            nextByte,
            savePath,
            false
          );
          return;
        }
        this.markComplete();
        return;
      }
      if (response.status === 206 && !fullRangeResponse) {
        await response.body?.cancel();
        response = await this.fetchWithStallTracking(url, {
          headers: requestHeaders,
          signal: this.abortController?.signal,
        });
        this.trackResumeCapability(
          response,
          requestHeaders.Range,
          requestHeaders["If-Range"]
        );
      }
    } else {
      response = await this.fetchWithStallTracking(url, {
        headers: requestHeaders,
        signal: this.abortController?.signal,
      });
      this.trackResumeCapability(
        response,
        requestHeaders.Range,
        requestHeaders["If-Range"]
      );
    }

    const contentType = response.headers.get("content-type") ?? "unknown";
    const contentLength = response.headers.get("content-length") ?? "unknown";
    logger.log(
      `[JsHttpDownloader] Response status=${response.status} content-type=${contentType} content-length=${contentLength}`
    );

    if (response.status === 416 && startByte > 0) {
      const remoteTotalSize = this.parseTotalSizeFrom416(response);

      if (
        !this.shouldVerifyResumePrefix() &&
        remoteTotalSize !== null &&
        startByte === remoteTotalSize
      ) {
        this.fileSize = remoteTotalSize;
        this.bytesDownloaded = remoteTotalSize;
        this.status = "complete";
        this.retryCount = 0;
        this.downloadSpeed = 0;

        logger.log(
          "[JsHttpDownloader] Range not satisfiable but local file already complete"
        );
        return;
      }

      throw new Error(
        `[JsHttpDownloader] Range not satisfiable for resumed download (local=${startByte}, remote=${remoteTotalSize ?? "unknown"}). Keeping local file and aborting to avoid restart from zero.`
      );
    }

    if (response.status >= 400) {
      throw new HttpDownloadStatusError(
        response.status,
        isRetryableHttpStatus(response.status),
        parseRetryAfterMs(response.headers.get("retry-after"), Date.now())
      );
    }

    if (!response.ok && response.status !== 206) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }

    if (
      startByte > 0 &&
      response.status === 206 &&
      this.resourceValidator &&
      getStrongRangeValidator(response) !== this.resourceValidator
    ) {
      await response.body?.cancel();
      throw new Error(
        "The download resource changed while resuming; keeping the saved partial file."
      );
    }

    // Detect HTML error pages served with 200 status (e.g. expired CDN links)
    if (
      contentType.includes("text/html") ||
      contentType.includes("application/xhtml")
    ) {
      throw new Error(
        `The download link returned a web page instead of a file. It may have expired or be invalid.`
      );
    }

    const action = resolveResumeAction({
      startByte,
      status: response.status,
      partialStart: this.parseContentRangeStart(response),
    });

    let { flags, skipBytes, restart } = action;

    const contentEncoding = (response.headers.get("content-encoding") ?? "")
      .toLowerCase()
      .trim();
    if (contentEncoding && contentEncoding !== "identity" && startByte > 0) {
      if (this.shouldVerifyResumePrefix()) {
        throw new Error(
          "The server encoded the resumed archive response; keeping the saved partial file."
        );
      }
      logger.log(
        `[JsHttpDownloader] Response is "${contentEncoding}"-encoded; byte-offset resume is unreliable, restarting from byte 0`
      );
      flags = "w";
      skipBytes = 0;
      restart = true;
    }

    if (this.shouldVerifyResumePrefix() && startByte > 0) {
      const rangeStart = this.parseContentRangeStart(response);
      if (
        restart ||
        (response.status === 206 &&
          (rangeStart === null || rangeStart >= startByte))
      ) {
        throw new Error(
          "The archive server returned an unsafe byte range; keeping the saved partial file."
        );
      }
    }

    if (restart) {
      this.restartCount += 1;
      if (this.restartCount > MAX_RESTARTS_FROM_ZERO) {
        throw new Error(
          "The server keeps refusing to resume and the download cannot make progress; aborting to avoid endless re-downloads."
        );
      }
      this.bytesDownloaded = 0;
      this.resetSpeedTracking();
      logger.log(
        `[JsHttpDownloader] Restarting the file from byte 0 (restart ${this.restartCount}/${MAX_RESTARTS_FROM_ZERO}).`
      );
    } else if (action.rangeIgnored) {
      if (this.currentOptions?.requireRangeResume) {
        await response.body?.cancel();
        throw new Error(
          "The server ignored the resume request. Keeping the partial file instead of downloading it again."
        );
      }
      this.beginRecovery(skipBytes);
      logger.log(
        `[JsHttpDownloader] Server ignored the Range header (HTTP 200). Re-downloading ${skipBytes} bytes to preserve the existing partial.`
      );
    } else if (skipBytes > RESUME_OVERLAP_BYTES) {
      this.beginRecovery(skipBytes);
      logger.log(
        `[JsHttpDownloader] Server sent ${skipBytes} saved bytes before the resume offset; verifying them before appending.`
      );
    } else if (skipBytes > 0) {
      logger.log(
        `[JsHttpDownloader] Partial response started before the resume offset; discarding ${skipBytes} overlapping body bytes.`
      );
    }

    this.parseFileSize(response, startByte);
    if (
      this.currentOptions?.expectedSize !== undefined &&
      this.fileSize !== this.currentOptions.expectedSize
    ) {
      await response.body?.cancel();
      throw new Error(
        "The download server returned a different file size. Keeping the partial file."
      );
    }

    const actualFilePath = this.resolveOutputPath(
      response,
      filePath,
      savePath,
      usedFallback,
      flags === "w"
    );

    if (!response.body) {
      throw new Error("Response body is null");
    }

    let savedPrefix: FileHandle | null = null;
    if (this.shouldVerifyResumePrefix() && skipBytes > 0) {
      savedPrefix = await fs.promises.open(actualFilePath, "r");
    }

    try {
      this.writeStream = fs.createWriteStream(actualFilePath, { flags });
      const readableStream = this.createReadableStream(
        response.body.getReader(),
        skipBytes,
        savedPrefix,
        response.status === 200
          ? 0
          : (this.parseContentRangeStart(response) ?? 0)
      );
      await pipeline(readableStream, this.writeStream, {
        signal: this.abortController!.signal,
      });
    } finally {
      await savedPrefix?.close();
    }

    if (
      this.fileSize > 0 &&
      fs.statSync(actualFilePath).size !== this.fileSize
    ) {
      throw new Error(
        "The archive download ended before its expected size; keeping the partial file."
      );
    }

    this.markComplete();
  }

  private async fetchWithStallTracking(
    url: string,
    options: RequestInit
  ): Promise<Response> {
    this.pendingReadSince = Date.now();
    try {
      return await fetch(url, options);
    } finally {
      this.pendingReadSince = null;
    }
  }

  private resolveOutputPath(
    response: Response,
    filePath: string,
    savePath: string,
    usedFallback: boolean,
    writingFreshFile: boolean
  ): string {
    if (!writingFreshFile || this.resolvedFilename !== null) return filePath;

    const urlDerivedFilename = path.basename(filePath);
    const headerFilename = this.parseContentDisposition(response);
    const preserveFilename = Boolean(
      this.currentOptions?.preserveFilename && this.currentOptions.filename
    );
    const output = chooseDownloadOutputPath(
      filePath,
      savePath,
      headerFilename,
      preserveFilename
    );
    this.outputFilePath = output.filePath;
    if (preserveFilename) {
      this.resolvedFilename = output.filename;
      return output.filePath;
    }
    if (headerFilename) {
      if (headerFilename !== urlDerivedFilename) {
        logger.log(
          `[JsHttpDownloader] Filename mismatch detected. URL-derived="${urlDerivedFilename}" header-derived="${headerFilename}"`
        );
      }
      this.folderName = output.filename;
      this.resolvedFilename = output.filename;
      fs.mkdirSync(path.dirname(output.filePath), { recursive: true });
      logger.log(
        `[JsHttpDownloader] Using filename from Content-Disposition: ${headerFilename}`
      );
      return output.filePath;
    }

    this.resolvedFilename = urlDerivedFilename;
    if (usedFallback) {
      logger.log(
        "[JsHttpDownloader] Content-Disposition filename not found, using fallback filename"
      );
    }
    return filePath;
  }

  private markComplete(): void {
    this.status = "complete";
    this.retryCount = 0;
    this.statusRetryCount = 0;
    this.budgetResets = 0;
    this.restartCount = 0;
    this.isReconnecting = false;
    this.resetRecoveryState();
    this.downloadSpeed = 0;
    logger.log(
      `[JsHttpDownloader] Download complete (${this.bytesDownloaded} bytes)`
    );
  }

  private parseContentDisposition(response: Response): string | undefined {
    const header = response.headers.get("content-disposition");
    if (!header) return undefined;

    const filenameStarMatch = /filename\*\s*=\s*([^;]+)/i.exec(header);
    if (filenameStarMatch?.[1]) {
      const rawValue = filenameStarMatch[1].trim().replace(/^["']|["']$/g, "");
      const encodedPart = rawValue.includes("''")
        ? rawValue.split("''").slice(1).join("''")
        : rawValue;
      const decoded = this.decodeFilenameValue(encodedPart);
      if (decoded) return decoded;
    }

    const filenameMatch = /filename\s*=\s*([^;]+)/i.exec(header);
    if (filenameMatch?.[1]) {
      const rawValue = filenameMatch[1].trim().replace(/^["']|["']$/g, "");
      const decoded = this.decodeFilenameValue(rawValue);
      if (decoded) return decoded;
    }

    return undefined;
  }

  private decodeFilenameValue(value: string): string | undefined {
    const normalized = value.trim();
    if (!normalized) return undefined;

    const sanitize = (name: string) =>
      path
        .basename(name)
        .replaceAll(/[<>:"/\\|?*]/g, "_")
        .split("")
        .filter((char) => char.charCodeAt(0) >= 32)
        .join("")
        .trim();

    try {
      const decoded = decodeURIComponent(normalized);
      const sanitized = sanitize(decoded);
      return sanitized || undefined;
    } catch {
      const sanitized = sanitize(normalized);
      return sanitized || undefined;
    }
  }

  private resetRecoveryState(): void {
    this.isRecovering = false;
    this.recoverBytesTotal = 0;
    this.recoverBytesDone = 0;
    this.recoverBytesAtLastUpdate = 0;
  }

  private beginRecovery(totalBytes: number): void {
    this.isRecovering = true;
    this.isReconnecting = false;
    this.recoverBytesTotal = totalBytes;
    this.recoverBytesDone = 0;
    this.recoverBytesAtLastUpdate = 0;
    this.recoverSpeedLastUpdate = Date.now();
    this.downloadSpeed = 0;
  }

  private trackRecoveredBytes(skipped: number): void {
    if (!this.isRecovering || skipped <= 0) return;

    this.recoverBytesDone += skipped;
    const now = Date.now();
    const elapsed = (now - this.recoverSpeedLastUpdate) / 1000;
    if (elapsed >= 1) {
      this.downloadSpeed = Math.max(
        0,
        (this.recoverBytesDone - this.recoverBytesAtLastUpdate) / elapsed
      );
      this.recoverSpeedLastUpdate = now;
      this.recoverBytesAtLastUpdate = this.recoverBytesDone;
    }
  }

  private finishRecovery(): void {
    if (!this.isRecovering) return;

    this.isRecovering = false;
    this.recoverBytesDone = this.recoverBytesTotal;
    this.resetSpeedTracking();
  }

  private createReadableStream(
    reader: ReadableStreamDefaultReader<Uint8Array>,
    skipBytes = 0,
    savedPrefix: FileHandle | null = null,
    prefixOffset = 0
  ): Readable {
    const applyThrottle = this.applyThrottle.bind(this);
    const markReadPending = () => {
      this.pendingReadSince = Date.now();
    };
    const clearReadPending = () => {
      this.pendingReadSince = null;
    };
    const countReceived = (length: number) => {
      this.attemptBytesReceived += length;
    };
    const applyRecoveryTracking = (
      plan: ReturnType<typeof applySkip>,
      length: number
    ) => {
      const skipped = plan.shouldWrite ? plan.writeOffset : length;
      if (skipped > 0) this.trackRecoveredBytes(skipped);
      if (plan.newRemainingToSkip === 0) this.finishRecovery();
    };
    const onChunk = (length: number) => {
      if (this.isReconnecting) {
        this.isReconnecting = false;
      }
      this.urlRefreshAttempted = false;
      this.bytesDownloaded += length;
      this.updateSpeed();
    };
    let remainingToSkip = skipBytes;

    const finishRead = (output: Readable) => {
      if (remainingToSkip > 0) {
        output.destroy(
          new Error(
            `[JsHttpDownloader] Server body shorter than the existing partial (missing ${remainingToSkip} bytes); refusing to append a truncated file.`
          )
        );
      } else {
        output.push(null);
      }
    };

    const processValue = async (value: Uint8Array, output: Readable) => {
      countReceived(value.length);
      const plan = applySkip(remainingToSkip, value.length);
      remainingToSkip = plan.newRemainingToSkip;
      const skipped = plan.shouldWrite ? plan.writeOffset : value.length;
      if (savedPrefix && skipped > 0) {
        await verifyResumePrefixChunk(
          savedPrefix,
          value,
          prefixOffset,
          skipped
        );
        prefixOffset += skipped;
      }
      applyRecoveryTracking(plan, value.length);
      if (!plan.shouldWrite) return false;

      const chunk =
        plan.writeOffset > 0 ? value.subarray(plan.writeOffset) : value;
      await applyThrottle(chunk.length);
      this.abortController?.signal.throwIfAborted();
      onChunk(chunk.length);
      output.push(Buffer.from(chunk));
      return true;
    };

    const readNext = async (output: Readable) => {
      try {
        for (;;) {
          markReadPending();
          const { done, value } = await reader.read();
          clearReadPending();
          if (done) {
            finishRead(output);
            return;
          }
          if (await processValue(value, output)) return;
        }
      } catch (error) {
        clearReadPending();
        output.destroy(error as Error);
      }
    };

    return new Readable({
      read() {
        void readNext(this);
      },
      destroy(err, callback) {
        reader
          .cancel()
          .catch(() => undefined)
          .finally(() => callback(err));
      },
    });
  }

  private handleDownloadError(err: Error): void {
    this.isReconnecting = false;
    this.resetRecoveryState();
    if (
      err.name === "AbortError" ||
      (err as NodeJS.ErrnoException).code === "ERR_STREAM_PREMATURE_CLOSE"
    ) {
      logger.log("[JsHttpDownloader] Download aborted");
      this.status = "paused";
    } else {
      logger.error("[JsHttpDownloader] Download error:", err);
      this.status = "error";
      throw err;
    }
  }

  setReconnecting(value: boolean): void {
    this.isReconnecting = value;
    if (value) {
      this.downloadSpeed = 0;
    }
  }

  reconnect(): void {
    if (!this.isDownloading || this.isPaused) return;

    logger.log(
      "[JsHttpDownloader] Network change detected; reconnecting and resuming"
    );
    this.isReconnecting = true;
    this.isReconnectRetry = true;
    this.downloadSpeed = 0;
    this.pendingReadSince = null;
    if (this.abortController) {
      this.abortController.abort();
    }
  }

  stopForNoNetwork(): void {
    logger.log(
      "[JsHttpDownloader] No internet connection; pausing download and keeping the partial file"
    );
    this.isReconnecting = false;
    this.pauseDownload();
  }

  pauseDownload(): void {
    logger.log("[JsHttpDownloader] Pausing download");
    this.isPaused = true;
    this.pendingReadSince = null;
    this.stopStallDetection();
    if (this.abortController) {
      this.abortController.abort();
    }
    this.status = "paused";
    this.downloadSpeed = 0;
  }

  cancelDownload(deleteFile = true): void {
    logger.log("[JsHttpDownloader] Cancelling download");
    this.isPaused = true;
    this.pendingReadSince = null;
    this.stopStallDetection();

    if (this.abortController) {
      this.abortController.abort();
    }

    this.cleanupResources();

    if (deleteFile && this.currentOptions && this.status !== "complete") {
      const filePath = path.join(this.currentOptions.savePath, this.folderName);
      if (fs.existsSync(filePath)) {
        try {
          fs.unlinkSync(filePath);
          removeRangeState(filePath);
          logger.log("[JsHttpDownloader] Deleted partial file");
        } catch (err) {
          logger.error(
            "[JsHttpDownloader] Failed to delete partial file:",
            err
          );
        }
      }
    }

    this.reset();
  }

  getDownloadStatus(): JsHttpDownloaderStatus | null {
    if (!this.currentOptions && this.status !== "active") {
      return null;
    }

    let progress = 0;
    if (this.status === "complete") {
      progress = 1;
    } else if (this.fileSize > 0) {
      progress = clampProgress(this.bytesDownloaded / this.fileSize);
    }

    return {
      folderName: this.folderName,
      fileSize: this.fileSize,
      progress,
      downloadSpeed: this.downloadSpeed,
      numPeers: 0,
      numSeeds: 0,
      status: this.status,
      bytesDownloaded: this.bytesDownloaded,
      isReconnecting: this.isReconnecting,
      isRecovering: this.isRecovering,
      resumeCapability: this.resumeCapability,
      recoveryProgress:
        this.recoverBytesTotal > 0
          ? clampProgress(this.recoverBytesDone / this.recoverBytesTotal)
          : 0,
    };
  }

  private updateSpeed(): void {
    const now = Date.now();
    const elapsed = (now - this.lastSpeedUpdate) / 1000;

    if (elapsed >= 1) {
      const bytesDelta = this.bytesDownloaded - this.bytesAtLastSpeedUpdate;
      this.downloadSpeed = bytesDelta / elapsed;
      this.lastSpeedUpdate = now;
      this.bytesAtLastSpeedUpdate = this.bytesDownloaded;
    }
  }

  private extractFilename(url: string): string | undefined {
    try {
      const urlObj = new URL(url);
      const pathname = urlObj.pathname;
      const pathParts = pathname.split("/");
      const filename = pathParts.at(-1);

      if (filename?.includes(".") && filename.length > 0) {
        return decodeURIComponent(filename);
      }
    } catch {
      // Invalid URL
    }
    return undefined;
  }

  private cleanupResources(): void {
    if (this.writeStream) {
      this.writeStream.destroy();
      this.writeStream = null;
    }
    this.abortController?.abort();
    this.abortController = null;
  }

  private reset(): void {
    this.currentOptions = null;
    this.outputFilePath = null;
    this.resolvedFilename = null;
    this.bytesDownloaded = 0;
    this.fileSize = 0;
    this.downloadSpeed = 0;
    this.status = "paused";
    this.folderName = "";
    this.resourceValidator = null;
    this.savedRangeState = null;
    this.verifyUnvalidatedResumeOverlap = false;
    this.resumeCapability = "unknown";
    this.isDownloading = false;
    this.retryCount = 0;
    this.statusRetryCount = 0;
    this.budgetResets = 0;
    this.attemptBytesReceived = 0;
    this.restartCount = 0;
    this.pendingReadSince = null;
    this.isStallRetry = false;
    this.isReconnecting = false;
    this.isReconnectRetry = false;
    this.resetRecoveryState();
    this.resetThrottleWindow();
  }
}
