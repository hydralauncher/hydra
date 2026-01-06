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

    const resolvedFilename =
      filename || this.extractFilename(url) || "download";
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

    // Reset speed tracking to avoid incorrect speed calculation after resume
    this.lastSpeedUpdate = Date.now();
    this.bytesAtLastSpeedUpdate = this.bytesDownloaded;
    this.downloadSpeed = 0;

    const requestHeaders: Record<string, string> = { ...headers };
    if (startByte > 0) {
      requestHeaders["Range"] = `bytes=${startByte}-`;
    }

    try {
      const response = await fetch(url, {
        headers: requestHeaders,
        signal: this.abortController.signal,
      });

      if (!response.ok && response.status !== 206) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }

      const contentLength = response.headers.get("content-length");
      const contentRange = response.headers.get("content-range");

      if (contentRange) {
        const match = contentRange.match(/bytes \d+-\d+\/(\d+)/);
        if (match) {
          this.fileSize = parseInt(match[1], 10);
        }
      } else if (contentLength) {
        this.fileSize = startByte + parseInt(contentLength, 10);
      }

      if (!response.body) {
        throw new Error("Response body is null");
      }

      const flags = startByte > 0 ? "a" : "w";
      this.writeStream = fs.createWriteStream(filePath, { flags });

      const reader = response.body.getReader();
      const onChunk = (length: number) => {
        this.bytesDownloaded += length;
        this.updateSpeed();
      };

      const readableStream = new Readable({
        async read() {
          try {
            const { done, value } = await reader.read();

            if (done) {
              this.push(null);
              return;
            }

            onChunk(value.length);
            this.push(Buffer.from(value));
          } catch (err) {
            if ((err as Error).name === "AbortError") {
              this.push(null);
            } else {
              this.destroy(err as Error);
            }
          }
        },
      });

      await pipeline(readableStream, this.writeStream);

      this.status = "complete";
      this.downloadSpeed = 0;
      logger.log("[JsHttpDownloader] Download complete");
    } catch (err) {
      if ((err as Error).name === "AbortError") {
        logger.log("[JsHttpDownloader] Download aborted");
        this.status = "paused";
      } else {
        logger.error("[JsHttpDownloader] Download error:", err);
        this.status = "error";
        throw err;
      }
    } finally {
      this.isDownloading = false;
      this.cleanup();
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

  cancelDownload(): void {
    if (this.abortController) {
      logger.log("[JsHttpDownloader] Cancelling download");
      this.abortController.abort();
    }

    this.cleanup();

    if (this.currentOptions) {
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

    return {
      folderName: this.folderName,
      fileSize: this.fileSize,
      progress: this.fileSize > 0 ? this.bytesDownloaded / this.fileSize : 0,
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
      const filename = pathParts[pathParts.length - 1];

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
