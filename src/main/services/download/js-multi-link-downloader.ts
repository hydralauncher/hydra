import { JsHttpDownloader, JsHttpDownloaderStatus } from "./js-http-downloader";
import { logger } from "../logger";

export interface JsMultiLinkDownloaderOptions {
  urls: string[];
  savePath: string;
  headers?: Record<string, string>;
  totalSize?: number;
}

interface CompletedDownload {
  name: string;
  size: number;
}

export class JsMultiLinkDownloader {
  private downloader: JsHttpDownloader | null = null;
  private currentOptions: JsMultiLinkDownloaderOptions | null = null;
  private currentUrlIndex = 0;
  private completedDownloads: CompletedDownload[] = [];
  private totalSize: number | null = null;
  private isDownloading = false;
  private isPaused = false;

  async startDownload(options: JsMultiLinkDownloaderOptions): Promise<void> {
    this.currentOptions = options;
    this.currentUrlIndex = 0;
    this.completedDownloads = [];
    this.totalSize = options.totalSize ?? null;
    this.isDownloading = true;
    this.isPaused = false;

    await this.downloadNextUrl();
  }

  private async downloadNextUrl(): Promise<void> {
    if (!this.currentOptions || this.isPaused) {
      return;
    }

    const { urls, savePath, headers } = this.currentOptions;

    if (this.currentUrlIndex >= urls.length) {
      logger.log("[JsMultiLinkDownloader] All downloads complete");
      this.isDownloading = false;
      return;
    }

    const url = urls[this.currentUrlIndex];
    logger.log(
      `[JsMultiLinkDownloader] Starting download ${this.currentUrlIndex + 1}/${urls.length}`
    );

    this.downloader = new JsHttpDownloader();

    try {
      await this.downloader.startDownload({
        url,
        savePath,
        headers,
      });

      const status = this.downloader.getDownloadStatus();
      if (status && status.status === "complete") {
        this.completedDownloads.push({
          name: status.folderName,
          size: status.fileSize,
        });
      }

      this.currentUrlIndex++;
      this.downloader = null;

      if (!this.isPaused) {
        await this.downloadNextUrl();
      }
    } catch (err) {
      logger.error("[JsMultiLinkDownloader] Download error:", err);
      throw err;
    }
  }

  pauseDownload(): void {
    logger.log("[JsMultiLinkDownloader] Pausing download");
    this.isPaused = true;
    if (this.downloader) {
      this.downloader.pauseDownload();
    }
  }

  async resumeDownload(): Promise<void> {
    if (!this.currentOptions) {
      throw new Error("No download options available for resume");
    }

    logger.log("[JsMultiLinkDownloader] Resuming download");
    this.isPaused = false;
    this.isDownloading = true;

    if (this.downloader) {
      await this.downloader.startDownload({
        url: this.currentOptions.urls[this.currentUrlIndex],
        savePath: this.currentOptions.savePath,
        headers: this.currentOptions.headers,
      });

      const status = this.downloader.getDownloadStatus();
      if (status && status.status === "complete") {
        this.completedDownloads.push({
          name: status.folderName,
          size: status.fileSize,
        });
        this.currentUrlIndex++;
        this.downloader = null;
        await this.downloadNextUrl();
      }
    } else {
      await this.downloadNextUrl();
    }
  }

  cancelDownload(): void {
    logger.log("[JsMultiLinkDownloader] Cancelling download");
    this.isPaused = true;
    this.isDownloading = false;

    if (this.downloader) {
      this.downloader.cancelDownload();
      this.downloader = null;
    }

    this.reset();
  }

  getDownloadStatus(): JsHttpDownloaderStatus | null {
    if (!this.currentOptions && this.completedDownloads.length === 0) {
      return null;
    }

    let totalBytesDownloaded = 0;
    let currentDownloadSpeed = 0;
    let currentFolderName = "";
    let currentStatus: "active" | "paused" | "complete" | "error" = "active";

    for (const completed of this.completedDownloads) {
      totalBytesDownloaded += completed.size;
    }

    if (this.downloader) {
      const status = this.downloader.getDownloadStatus();
      if (status) {
        totalBytesDownloaded += status.bytesDownloaded;
        currentDownloadSpeed = status.downloadSpeed;
        currentFolderName = status.folderName;
        currentStatus = status.status;
      }
    } else if (this.completedDownloads.length > 0) {
      currentFolderName = this.completedDownloads[0].name;
    }

    if (currentFolderName?.includes("/")) {
      currentFolderName = currentFolderName.split("/")[0];
    }

    const totalFileSize =
      this.totalSize ||
      this.completedDownloads.reduce((sum, d) => sum + d.size, 0) +
        (this.downloader?.getDownloadStatus()?.fileSize || 0);

    const allComplete =
      !this.isDownloading &&
      this.currentOptions &&
      this.currentUrlIndex >= this.currentOptions.urls.length;

    if (allComplete) {
      currentStatus = "complete";
    } else if (this.isPaused) {
      currentStatus = "paused";
    }

    return {
      folderName: currentFolderName,
      fileSize: totalFileSize,
      progress: totalFileSize > 0 ? totalBytesDownloaded / totalFileSize : 0,
      downloadSpeed: currentDownloadSpeed,
      numPeers: 0,
      numSeeds: 0,
      status: currentStatus,
      bytesDownloaded: totalBytesDownloaded,
    };
  }

  private reset(): void {
    this.currentOptions = null;
    this.currentUrlIndex = 0;
    this.completedDownloads = [];
    this.totalSize = null;
    this.isDownloading = false;
    this.isPaused = false;
  }
}
