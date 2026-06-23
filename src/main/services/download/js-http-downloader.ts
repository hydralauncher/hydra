import fs from "node:fs";
import path from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { logger } from "../logger";
import {
  applySkip,
  clampProgress,
  computeFileSize,
  isRetryableDownloadError,
  isRetryableHttpStatus,
  MAX_BUDGET_RESETS,
  MAX_RESTARTS_FROM_ZERO,
  PROGRESS_RESET_THRESHOLD_BYTES,
  resolveResumeAction,
  shouldResetRetryBudget,
  stallDetected,
} from "./js-http-downloader-helpers";

export interface JsHttpDownloaderStatus {
  folderName: string;
  fileSize: number;
  progress: number;
  downloadSpeed: number;
  numPeers: number;
  numSeeds: number;
  status: "active" | "paused" | "complete" | "error";
  bytesDownloaded: number;
}

export interface JsHttpDownloaderOptions {
  url: string;
  savePath: string;
  filename?: string;
  headers?: Record<string, string>;
}

const MAX_RETRY_ATTEMPTS = 10;
const INITIAL_RETRY_DELAY_MS = 1000;
const MAX_RETRY_DELAY_MS = 15000;
const STALL_TIMEOUT_MS = 30000;
const STALL_CHECK_INTERVAL_MS = 2000;
export const DEFAULT_DOWNLOAD_USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:144.0) Gecko/20100101 Firefox/144.0";

class HttpDownloadStatusError extends Error {
  constructor(
    public readonly statusCode: number,
    public readonly retryable = false
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

  private bytesDownloaded = 0;
  private fileSize = 0;
  private downloadSpeed = 0;
  private status: "active" | "paused" | "complete" | "error" = "paused";
  private folderName = "";
  private lastSpeedUpdate = Date.now();
  private bytesAtLastSpeedUpdate = 0;
  private isDownloading = false;

  private retryCount = 0;
  private budgetResets = 0;
  private attemptBytesReceived = 0;
  private restartCount = 0;
  private pendingReadSince: number | null = null;
  private stallCheckInterval: NodeJS.Timeout | null = null;
  private isPaused = false;
  private isStallRetry = false;
  private maxDownloadSpeedBytesPerSecond: number | null = null;
  private throttleWindowStart = Date.now();
  private bytesTransferredInThrottleWindow = 0;

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
      return this.resumeDownload();
    }

    this.currentOptions = options;
    this.isPaused = false;
    this.retryCount = 0;
    this.budgetResets = 0;
    this.attemptBytesReceived = 0;
    this.restartCount = 0;
    this.isStallRetry = false;
    this.fileSize = 0;
    this.resolvedFilename = null;
    this.pendingReadSince = null;
    this.resetThrottleWindow();
    await this.startDownloadWithRetry();
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

        const { url, savePath, filename, headers = {} } = this.currentOptions;
        const { filePath, startByte, usedFallback } = this.prepareDownloadPath(
          savePath,
          filename,
          url
        );
        const requestHeaders = this.buildRequestHeaders(headers, startByte);

        this.startStallDetection();

        try {
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

  private startStallDetection(): void {
    this.stopStallDetection();
    this.stallCheckInterval = setInterval(() => {
      if (this.status !== "active" || this.isPaused || this.isStallRetry) {
        return;
      }

      if (stallDetected(this.pendingReadSince, Date.now(), STALL_TIMEOUT_MS)) {
        const blockedSeconds = Math.round(
          (Date.now() - (this.pendingReadSince ?? Date.now())) / 1000
        );
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
    if (this.isPaused) {
      logger.log("[JsHttpDownloader] Download paused/cancelled by user");
      this.status = "paused";
      return false;
    }

    const wasStallRetry = this.isStallRetry;
    const isAbortError = err.name === "AbortError";
    const isRetryable = wasStallRetry || isRetryableDownloadError(err);

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
      this.budgetResets += 1;
    }

    const canRetry = this.retryCount < MAX_RETRY_ATTEMPTS;

    if (isRetryable && canRetry) {
      this.retryCount++;
      const delay = Math.min(
        INITIAL_RETRY_DELAY_MS * Math.pow(2, this.retryCount - 1),
        MAX_RETRY_DELAY_MS
      );

      const reason = wasStallRetry ? "stall detected" : err.message;
      logger.log(
        `[JsHttpDownloader] Retryable error (${reason}). ` +
          `Retry ${this.retryCount}/${MAX_RETRY_ATTEMPTS} in ${delay}ms`
      );

      await this.sleep(delay);
      return !this.isPaused;
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

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  private resetThrottleWindow(): void {
    this.throttleWindowStart = Date.now();
    this.bytesTransferredInThrottleWindow = 0;
  }

  private async applyThrottle(chunkSize: number): Promise<void> {
    const limit = this.maxDownloadSpeedBytesPerSecond;
    if (!limit) return;

    while (!this.isPaused && !this.abortController?.signal.aborted) {
      const now = Date.now();
      const elapsed = now - this.throttleWindowStart;

      if (elapsed >= 1000) {
        this.throttleWindowStart = now;
        this.bytesTransferredInThrottleWindow = 0;
      }

      const availableBytes = limit - this.bytesTransferredInThrottleWindow;
      if (
        availableBytes >= chunkSize ||
        this.bytesTransferredInThrottleWindow === 0
      ) {
        this.bytesTransferredInThrottleWindow += chunkSize;
        return;
      }

      const waitMs = Math.max(1, 1000 - elapsed);
      await this.sleep(waitMs);
    }
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

    if (!fs.existsSync(savePath)) {
      fs.mkdirSync(savePath, { recursive: true });
    }

    const targetDir = path.dirname(filePath);
    if (!fs.existsSync(targetDir)) {
      fs.mkdirSync(targetDir, { recursive: true });
    }

    let startByte = 0;
    if (fs.existsSync(filePath)) {
      const stats = fs.statSync(filePath);
      startByte = stats.size;
      logger.log(`[JsHttpDownloader] Resuming download from byte ${startByte}`);
    }

    this.bytesDownloaded = startByte;
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

    if (startByte > 0) {
      requestHeaders["Range"] = `bytes=${startByte}-`;
    }
    return requestHeaders;
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
    const response = await fetch(url, {
      headers: requestHeaders,
      signal: this.abortController?.signal,
    });

    const contentType = response.headers.get("content-type") ?? "unknown";
    const contentLength = response.headers.get("content-length") ?? "unknown";
    logger.log(
      `[JsHttpDownloader] Response status=${response.status} content-type=${contentType} content-length=${contentLength}`
    );

    if (response.status === 416 && startByte > 0) {
      const remoteTotalSize = this.parseTotalSizeFrom416(response);

      if (remoteTotalSize !== null && startByte === remoteTotalSize) {
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
        isRetryableHttpStatus(response.status)
      );
    }

    if (!response.ok && response.status !== 206) {
      throw new Error(`HTTP error! status: ${response.status}`);
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
      logger.log(
        `[JsHttpDownloader] Response is "${contentEncoding}"-encoded; byte-offset resume is unreliable, restarting from byte 0`
      );
      flags = "w";
      skipBytes = 0;
      restart = true;
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
      logger.log(
        `[JsHttpDownloader] Server ignored the Range header (HTTP 200). Discarding ${skipBytes} body bytes to preserve the existing partial.`
      );
    } else if (skipBytes > 0) {
      logger.log(
        `[JsHttpDownloader] Partial response started before the resume offset; discarding ${skipBytes} overlapping body bytes.`
      );
    }

    this.parseFileSize(response, startByte);

    // Resolve the on-disk filename once and pin it for the download's
    // lifetime so a later restart cannot orphan the existing partial.
    const writingFreshFile = flags === "w";
    let actualFilePath = filePath;
    if (writingFreshFile && this.resolvedFilename === null) {
      const urlDerivedFilename = path.basename(filePath);
      const headerFilename = this.parseContentDisposition(response);
      if (headerFilename) {
        if (headerFilename !== urlDerivedFilename) {
          logger.log(
            `[JsHttpDownloader] Filename mismatch detected. URL-derived="${urlDerivedFilename}" header-derived="${headerFilename}"`
          );
        }
        actualFilePath = path.join(savePath, headerFilename);
        this.folderName = headerFilename;
        this.resolvedFilename = headerFilename;
        const targetDir = path.dirname(actualFilePath);
        if (!fs.existsSync(targetDir)) {
          fs.mkdirSync(targetDir, { recursive: true });
        }
        logger.log(
          `[JsHttpDownloader] Using filename from Content-Disposition: ${headerFilename}`
        );
      } else {
        this.resolvedFilename = path.basename(actualFilePath);
        if (usedFallback) {
          logger.log(
            "[JsHttpDownloader] Content-Disposition filename not found, using fallback filename"
          );
        }
      }
    }

    if (!response.body) {
      throw new Error("Response body is null");
    }

    this.writeStream = fs.createWriteStream(actualFilePath, { flags });

    const readableStream = this.createReadableStream(
      response.body.getReader(),
      skipBytes
    );
    await pipeline(readableStream, this.writeStream);

    this.status = "complete";
    this.retryCount = 0;
    this.budgetResets = 0;
    this.restartCount = 0;
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

  private createReadableStream(
    reader: ReadableStreamDefaultReader<Uint8Array>,
    skipBytes = 0
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
    const onChunk = (length: number) => {
      this.bytesDownloaded += length;
      this.updateSpeed();
    };
    let remainingToSkip = skipBytes;

    return new Readable({
      read() {
        void (async () => {
          try {
            for (;;) {
              markReadPending();
              const { done, value } = await reader.read();
              clearReadPending();

              if (done) {
                if (remainingToSkip > 0) {
                  this.destroy(
                    new Error(
                      `[JsHttpDownloader] Server body shorter than the existing partial (missing ${remainingToSkip} bytes); refusing to append a truncated file.`
                    )
                  );
                  return;
                }
                this.push(null);
                return;
              }

              countReceived(value.length);

              const plan = applySkip(remainingToSkip, value.length);
              remainingToSkip = plan.newRemainingToSkip;
              if (!plan.shouldWrite) {
                continue;
              }

              const chunk =
                plan.writeOffset > 0 ? value.subarray(plan.writeOffset) : value;
              await applyThrottle(chunk.length);
              onChunk(chunk.length);
              this.push(Buffer.from(chunk));
              return;
            }
          } catch (err) {
            clearReadPending();
            this.destroy(err as Error);
          }
        })();
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

  private async resumeDownload(): Promise<void> {
    if (!this.currentOptions) {
      throw new Error("No download options available for resume");
    }
    this.isDownloading = false;
    this.isPaused = false;
    this.retryCount = 0;
    this.budgetResets = 0;
    this.attemptBytesReceived = 0;
    this.restartCount = 0;
    this.isStallRetry = false;
    this.pendingReadSince = null;
    await this.startDownloadWithRetry();
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
    this.abortController = null;
  }

  private reset(): void {
    this.currentOptions = null;
    this.resolvedFilename = null;
    this.bytesDownloaded = 0;
    this.fileSize = 0;
    this.downloadSpeed = 0;
    this.status = "paused";
    this.folderName = "";
    this.isDownloading = false;
    this.retryCount = 0;
    this.budgetResets = 0;
    this.attemptBytesReceived = 0;
    this.restartCount = 0;
    this.pendingReadSince = null;
    this.isStallRetry = false;
    this.resetThrottleWindow();
  }
}
