import fs from "node:fs";
import path from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { logger } from "../logger";

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
const STALL_TIMEOUT_MS = 8000;
const STALL_CHECK_INTERVAL_MS = 2000;

const RETRYABLE_ERROR_CODES = new Set([
  "ECONNRESET",
  "ETIMEDOUT",
  "ECONNREFUSED",
  "ENOTFOUND",
  "ENETUNREACH",
  "EHOSTUNREACH",
  "EPIPE",
  "EAI_AGAIN",
  "ECONNABORTED",
  "ESOCKETTIMEDOUT",
  "ERR_STREAM_PREMATURE_CLOSE",
]);

export class JsHttpDownloader {
  private abortController: AbortController | null = null;
  private writeStream: fs.WriteStream | null = null;
  private currentOptions: JsHttpDownloaderOptions | null = null;

  private bytesDownloaded = 0;
  private fileSize = 0;
  private downloadSpeed = 0;
  private status: "active" | "paused" | "complete" | "error" = "paused";
  private folderName = "";
  private lastSpeedUpdate = Date.now();
  private bytesAtLastSpeedUpdate = 0;
  private isDownloading = false;

  private retryCount = 0;
  private lastDataReceivedAt = Date.now();
  private stallCheckInterval: NodeJS.Timeout | null = null;
  private isPaused = false;
  private isStallRetry = false;

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
    await this.startDownloadWithRetry();
  }

  private async startDownloadWithRetry(): Promise<void> {
    if (!this.currentOptions) return;

    while (!this.isPaused) {
      this.abortController = new AbortController();
      this.status = "active";
      this.isDownloading = true;
      this.isStallRetry = false;
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

    this.isDownloading = false;
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

  private isRetryableError(err: Error): boolean {
    const nodeError = err as NodeJS.ErrnoException;
    if (nodeError.code && RETRYABLE_ERROR_CODES.has(nodeError.code)) {
      return true;
    }

    const message = err.message.toLowerCase();
    if (
      message.includes("network") ||
      message.includes("socket") ||
      message.includes("connection") ||
      message.includes("timeout") ||
      message.includes("aborted") ||
      message.includes("econnreset") ||
      message.includes("etimedout") ||
      message.includes("fetch failed")
    ) {
      return true;
    }

    return false;
  }

  private async handleDownloadErrorWithRetry(err: Error): Promise<boolean> {
    const wasStallRetry = this.isStallRetry;

    if (this.isPaused && !wasStallRetry) {
      logger.log("[JsHttpDownloader] Download paused by user");
      this.status = "paused";
      return false;
    }

    const isAbortError = err.name === "AbortError";
    const isRetryable = wasStallRetry || this.isRetryableError(err);
    const canRetry = this.retryCount < MAX_RETRY_ATTEMPTS;

    if (isRetryable && canRetry && !this.isPaused) {
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

    if (isAbortError && !wasStallRetry) {
      logger.log("[JsHttpDownloader] Download aborted");
      this.status = "paused";
    } else {
      this.handleDownloadError(err);
    }

    return false;
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  private prepareDownloadPath(
    savePath: string,
    filename: string | undefined,
    url: string
  ): { filePath: string; startByte: number; usedFallback: boolean } {
    const extractedFilename = filename || this.extractFilename(url);
    const usedFallback = !extractedFilename;
    const resolvedFilename = extractedFilename || "download";
    this.folderName = resolvedFilename;
    const filePath = path.join(savePath, resolvedFilename);

    if (!fs.existsSync(savePath)) {
      fs.mkdirSync(savePath, { recursive: true });
    }

    let startByte = 0;
    if (fs.existsSync(filePath)) {
      const stats = fs.statSync(filePath);
      startByte = stats.size;
      this.bytesDownloaded = startByte;
      logger.log(`[JsHttpDownloader] Resuming download from byte ${startByte}`);
    }

    this.resetSpeedTracking();
    return { filePath, startByte, usedFallback };
  }

  private buildRequestHeaders(
    headers: Record<string, string>,
    startByte: number
  ): Record<string, string> {
    const requestHeaders: Record<string, string> = { ...headers };
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

    if (response.status === 416 && startByte > 0) {
      logger.log(
        "[JsHttpDownloader] Range not satisfiable, deleting existing file and restarting"
      );
      if (fs.existsSync(filePath)) {
        fs.unlinkSync(filePath);
      }
      this.bytesDownloaded = 0;
      this.resetSpeedTracking();

      const headersWithoutRange = { ...requestHeaders };
      delete headersWithoutRange["Range"];

      return this.executeDownload(
        url,
        headersWithoutRange,
        filePath,
        0,
        savePath,
        usedFallback
      );
    }

    if (!response.ok && response.status !== 206) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }

    this.parseFileSize(response, startByte);

    let actualFilePath = filePath;
    if (usedFallback && startByte === 0) {
      const headerFilename = this.parseContentDisposition(response);
      if (headerFilename) {
        actualFilePath = path.join(savePath, headerFilename);
        this.folderName = headerFilename;
        logger.log(
          `[JsHttpDownloader] Using filename from Content-Disposition: ${headerFilename}`
        );
      }
    }

    if (!response.body) {
      throw new Error("Response body is null");
    }

    const flags = startByte > 0 ? "a" : "w";
    this.writeStream = fs.createWriteStream(actualFilePath, { flags });

    const readableStream = this.createReadableStream(response.body.getReader());
    await pipeline(readableStream, this.writeStream);

    this.status = "complete";
    this.retryCount = 0;
    this.downloadSpeed = 0;
    logger.log("[JsHttpDownloader] Download complete");
  }

  private parseContentDisposition(response: Response): string | undefined {
    const header = response.headers.get("content-disposition");
    if (!header) return undefined;

    const filenameMatch = /filename\*?=['"]?(?:UTF-8'')?([^"';\n]+)['"]?/i.exec(
      header
    );
    if (filenameMatch?.[1]) {
      try {
        return decodeURIComponent(filenameMatch[1].trim());
      } catch {
        return filenameMatch[1].trim();
      }
    }
    return undefined;
  }

  private createReadableStream(
    reader: ReadableStreamDefaultReader<Uint8Array>
  ): Readable {
    const onChunk = (length: number) => {
      this.bytesDownloaded += length;
      this.lastDataReceivedAt = Date.now();
      this.updateSpeed();
    };

    return new Readable({
      read() {
        reader
          .read()
          .then(({ done, value }) => {
            if (done) {
              this.push(null);
              return;
            }
            onChunk(value.length);
            this.push(Buffer.from(value));
          })
          .catch((err: Error) => {
            if (err.name === "AbortError") {
              this.push(null);
            } else {
              this.destroy(err);
            }
          });
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
    this.isDownloading = false;
    this.retryCount = 0;
    this.isPaused = false;
    this.isStallRetry = false;
  }
}
