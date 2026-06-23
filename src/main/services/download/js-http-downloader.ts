import fs from "node:fs";
import path from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { logger } from "../logger";
import {
  classifyRetryOutcome,
  isRetryableDownloadError,
  PROGRESS_RESET_THRESHOLD_BYTES,
  resolveResumeFilename,
  shouldResetRetryBudget,
  shouldRestartFromIgnoredRange,
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
  constructor(public readonly statusCode: number) {
    super(`The download link is not available (HTTP ${statusCode}).`);
    this.name = "HttpDownloadStatusError";
  }
}

export class JsHttpDownloader {
  private abortController: AbortController | null = null;
  private writeStream: fs.WriteStream | null = null;
  private currentOptions: JsHttpDownloaderOptions | null = null;
  private knownFilename: string | null = null;

  private bytesDownloaded = 0;
  private fileSize = 0;
  private downloadSpeed = 0;
  private status: "active" | "paused" | "complete" | "error" = "paused";
  private folderName = "";
  private lastSpeedUpdate = Date.now();
  private bytesAtLastSpeedUpdate = 0;
  private isDownloading = false;

  private retryCount = 0;
  private bytesAtAttemptStart = 0;
  private wasRangeIgnoredRestart = false;
  private lastDataReceivedAt = Date.now();
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
    this.isStallRetry = false;
    this.fileSize = 0;
    this.knownFilename = null;
    this.wasRangeIgnoredRestart = false;
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
        this.wasRangeIgnoredRestart = false;
        this.lastDataReceivedAt = Date.now();

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

      const timeSinceLastData = Date.now() - this.lastDataReceivedAt;
      if (timeSinceLastData > STALL_TIMEOUT_MS) {
        logger.log(
          `[JsHttpDownloader] Download stalled (no data for ${Math.round(timeSinceLastData / 1000)}s), triggering retry`
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
    const wasStallRetry = this.isStallRetry;
    const isAbortError = err.name === "AbortError";
    const isRetryable = wasStallRetry || isRetryableDownloadError(err);
    const canRetry = this.retryCount < MAX_RETRY_ATTEMPTS;

    const decision = classifyRetryOutcome({
      isPaused: this.isPaused,
      wasStallRetry,
      isAbortError,
      isRetryable,
      canRetry,
    });

    switch (decision) {
      case "retry": {
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

      case "paused": {
        logger.log("[JsHttpDownloader] Download paused");
        this.status = "paused";
        return false;
      }

      case "error-exhausted": {
        logger.error(
          `[JsHttpDownloader] Giving up after ${this.retryCount} retries`
        );
        this.status = "error";
        throw wasStallRetry
          ? new Error(
              "Download stalled repeatedly and could not be resumed after multiple retries."
            )
          : err;
      }

      default: {
        this.handleDownloadError(err);
        return false;
      }
    }
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

    while (!this.isPaused) {
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
    const { filename: resolvedFilename, usedFallback } = resolveResumeFilename({
      knownFilename: this.knownFilename,
      optionFilename: filename,
      url,
    });
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
    const contentRange = response.headers.get("content-range");
    if (contentRange) {
      const match = /bytes \d+-\d+\/(\d+)/.exec(contentRange);
      if (match) {
        this.fileSize = Number.parseInt(match[1], 10);
      }
      return;
    }

    const contentLength = response.headers.get("content-length");
    if (contentLength) {
      this.fileSize = startByte + Number.parseInt(contentLength, 10);
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
      throw new HttpDownloadStatusError(response.status);
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

    this.wasRangeIgnoredRestart = shouldRestartFromIgnoredRange(
      startByte,
      response.status
    );

    let effectiveStartByte = startByte;
    if (this.wasRangeIgnoredRestart) {
      logger.log(
        "[JsHttpDownloader] Server ignored the Range request (HTTP 200 for a resumed download). " +
          "Restarting the file from byte 0 to avoid appending a duplicate stream."
      );
      effectiveStartByte = 0;
      this.bytesDownloaded = 0;
      this.resetSpeedTracking();
    }

    this.parseFileSize(response, effectiveStartByte);

    let actualFilePath = filePath;
    if (effectiveStartByte === 0) {
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
        this.knownFilename = headerFilename;
        const targetDir = path.dirname(actualFilePath);
        if (!fs.existsSync(targetDir)) {
          fs.mkdirSync(targetDir, { recursive: true });
        }
        logger.log(
          `[JsHttpDownloader] Using filename from Content-Disposition: ${headerFilename}`
        );
      } else if (usedFallback) {
        logger.log(
          "[JsHttpDownloader] Content-Disposition filename not found, using fallback filename"
        );
      }
    }

    if (!response.body) {
      throw new Error("Response body is null");
    }

    const flags = effectiveStartByte > 0 ? "a" : "w";
    this.writeStream = fs.createWriteStream(actualFilePath, { flags });

    this.bytesAtAttemptStart = this.bytesDownloaded;

    const readableStream = this.createReadableStream(response.body.getReader());
    await pipeline(readableStream, this.writeStream);

    this.status = "complete";
    this.retryCount = 0;
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
    reader: ReadableStreamDefaultReader<Uint8Array>
  ): Readable {
    const applyThrottle = this.applyThrottle.bind(this);
    const onChunk = (length: number) => {
      this.bytesDownloaded += length;
      this.lastDataReceivedAt = Date.now();

      if (
        shouldResetRetryBudget(
          this.retryCount,
          this.bytesDownloaded,
          this.bytesAtAttemptStart,
          PROGRESS_RESET_THRESHOLD_BYTES,
          this.wasRangeIgnoredRestart
        )
      ) {
        logger.log(
          "[JsHttpDownloader] Download recovered and data is flowing; resetting retry budget"
        );
        this.retryCount = 0;
      }

      this.updateSpeed();
    };

    return new Readable({
      read() {
        void (async () => {
          try {
            const { done, value } = await reader.read();
            if (done) {
              this.push(null);
              return;
            }

            await applyThrottle(value.length);
            onChunk(value.length);
            this.push(Buffer.from(value));
          } catch (err) {
            this.destroy(err as Error);
          }
        })();
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
    this.isStallRetry = false;
    await this.startDownloadWithRetry();
  }

  pauseDownload(): void {
    logger.log("[JsHttpDownloader] Pausing download");
    this.isPaused = true;
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
      progress = this.bytesDownloaded / this.fileSize;
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

  private cleanupResources(): void {
    if (this.writeStream) {
      this.writeStream.close();
      this.writeStream = null;
    }
    this.abortController = null;
  }

  private reset(): void {
    this.currentOptions = null;
    this.bytesDownloaded = 0;
    this.fileSize = 0;
    this.downloadSpeed = 0;
    this.status = "paused";
    this.folderName = "";
    this.knownFilename = null;
    this.isDownloading = false;
    this.retryCount = 0;
    this.bytesAtAttemptStart = 0;
    this.wasRangeIgnoredRestart = false;
    this.isStallRetry = false;
    this.resetThrottleWindow();
  }
}
