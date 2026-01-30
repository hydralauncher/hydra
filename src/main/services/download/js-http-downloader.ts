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

  async startDownload(options: JsHttpDownloaderOptions): Promise<void> {
    if (this.isDownloading) {
      logger.log(
        "[JsHttpDownloader] Download already in progress, resuming..."
      );
      return this.resumeDownload();
    }

    this.currentOptions = options;
    this.abortController = new AbortController();
    this.status = "active";
    this.isDownloading = true;

    const { url, savePath, filename, headers = {} } = options;
    const { filePath, startByte, usedFallback } = this.prepareDownloadPath(
      savePath,
      filename,
      url
    );
    const requestHeaders = this.buildRequestHeaders(headers, startByte);

    try {
      await this.executeDownload(
        url,
        requestHeaders,
        filePath,
        startByte,
        savePath,
        usedFallback
      );
    } catch (err) {
      this.handleDownloadError(err as Error);
    } finally {
      this.isDownloading = false;
      this.cleanup();
    }
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

    // Handle 416 Range Not Satisfiable - existing file is larger than server file
    // This happens when downloading same game from different source
    if (response.status === 416 && startByte > 0) {
      logger.log(
        "[JsHttpDownloader] Range not satisfiable, deleting existing file and restarting"
      );
      if (fs.existsSync(filePath)) {
        fs.unlinkSync(filePath);
      }
      this.bytesDownloaded = 0;
      this.resetSpeedTracking();

      // Retry without Range header
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

    // If we used "download" fallback, try to get filename from Content-Disposition
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
    this.downloadSpeed = 0;
    logger.log("[JsHttpDownloader] Download complete");
  }

  private parseContentDisposition(response: Response): string | undefined {
    const header = response.headers.get("content-disposition");
    if (!header) return undefined;

    // Try to extract filename from Content-Disposition header
    // Formats: attachment; filename="file.zip" or attachment; filename=file.zip
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
    // Handle abort/cancellation errors - these are expected when user pauses/cancels
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
    await this.startDownload(this.currentOptions);
  }

  pauseDownload(): void {
    if (this.abortController) {
      logger.log("[JsHttpDownloader] Pausing download");
      this.abortController.abort();
      this.status = "paused";
      this.downloadSpeed = 0;
    }
  }

  cancelDownload(deleteFile = true): void {
    if (this.abortController) {
      logger.log("[JsHttpDownloader] Cancelling download");
      this.abortController.abort();
    }

    this.cleanup();

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

  private cleanup(): void {
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
  }
}
