import type { DownloadFile } from "@types";
import { DownloadThrottle } from "./download-throttle";
import {
  JsHttpDownloader,
  type JsHttpDownloaderOptions,
  type JsHttpDownloaderStatus,
} from "./js-http-downloader";
import {
  sampleJsBatchSpeed,
  type JsBatchSpeedSample,
} from "./js-http-downloader-helpers";
import {
  PARALLEL_RANGE_COUNT,
  PARALLEL_RANGE_SIZE,
} from "./parallel-range-download";

interface PreparedLink {
  url?: string;
  error?: unknown;
}

/** Owns all transfers and prepared links for one raw TorBox download. */
export class TorBoxBatchDownloader {
  private readonly controller = new AbortController();
  private readonly throttle = new DownloadThrottle();
  private readonly workers = new Map<number, JsHttpDownloader>();
  private readonly links = new Map<number, Promise<PreparedLink>>();
  private readonly files: DownloadFile[];
  private readonly pending: number[];
  private prefetchPosition = 0;
  private transferStarted = false;
  private failure: unknown;
  private activeRun: Promise<void> | null = null;
  private status: JsHttpDownloaderStatus["status"] = "active";
  private isReconnecting = false;
  private speed: JsBatchSpeedSample;

  constructor(
    files: DownloadFile[],
    private readonly folderName: string,
    private readonly resolveLink: (
      index: number,
      signal: AbortSignal
    ) => Promise<string>,
    private readonly getOptions: (
      index: number,
      url: string
    ) => JsHttpDownloaderOptions
  ) {
    this.files = files.map((file) => ({ ...file }));
    this.pending = this.files.flatMap((file, index) =>
      file.completed ? [] : [index]
    );
    this.speed = {
      lastSpeedUpdate: Date.now(),
      bytesAtLastSpeedUpdate: this.files.reduce(
        (sum, file) => sum + file.bytesDownloaded,
        0
      ),
      batchSpeed: 0,
    };
  }

  setMaxDownloadSpeedBytesPerSecond(limit: number | null): void {
    this.throttle.setLimit(limit);
  }

  startDownload(): Promise<void> {
    if (!this.activeRun) this.activeRun = this.run();
    return this.activeRun;
  }

  private prefetch(position: number): void {
    // At most four upcoming links, in addition to links already being consumed.
    const end = Math.min(this.pending.length, position + PARALLEL_RANGE_COUNT);
    while (this.prefetchPosition < end) {
      const index = this.pending[this.prefetchPosition++];
      if (this.controller.signal.aborted) break;
      if (!this.files[index].size || this.links.has(index)) continue;
      this.links.set(
        index,
        this.resolveLink(index, this.controller.signal).then(
          (url) => ({ url }),
          (error: unknown) => ({ error })
        )
      );
    }
  }

  private async downloadFile(position: number): Promise<void> {
    this.controller.signal.throwIfAborted();
    const index = this.pending[position];
    const file = this.files[index];
    this.prefetch(position);
    const prepared = file.size
      ? await this.links.get(index)
      : { url: "about:blank" };
    this.links.delete(index);
    this.controller.signal.throwIfAborted();
    if (prepared?.error) throw prepared.error;
    if (!prepared?.url) throw new Error("The download link is unavailable.");
    this.prefetch(position + 1);

    const downloader = new JsHttpDownloader();
    this.workers.set(index, downloader);
    const options = this.getOptions(index, prepared.url);
    options.throttle = this.throttle;
    options.allowParallelRanges = file.size > PARALLEL_RANGE_SIZE;
    options.parallelRangeConnections = options.allowParallelRanges
      ? PARALLEL_RANGE_COUNT
      : 1;
    options.refreshUrl = () => this.resolveLink(index, this.controller.signal);
    if (!this.transferStarted) {
      this.throttle.reset();
      this.transferStarted = true;
    }
    const run = downloader.startDownload(options);
    downloader.setReconnecting(this.isReconnecting);
    await run;
    const status = downloader.getDownloadStatus();
    if (status?.status === "complete" && status.bytesDownloaded === file.size) {
      file.bytesDownloaded = file.size;
      file.completed = true;
      this.workers.delete(index);
      return;
    }
    this.controller.signal.throwIfAborted();
    throw new Error("A downloaded file did not finish with the expected size.");
  }

  private async runSmallFiles(start: number, end: number): Promise<void> {
    let position = start;
    const runWorker = async () => {
      while (position < end && !this.controller.signal.aborted) {
        const next = position++;
        try {
          await this.downloadFile(next);
        } catch (error) {
          if (!this.controller.signal.aborted) {
            this.failure = error;
            this.stop("error");
          }
          throw error;
        }
      }
    };
    const results = await Promise.allSettled(
      Array.from(
        { length: Math.min(PARALLEL_RANGE_COUNT, end - start) },
        runWorker
      )
    );
    const failed = results.find((result) => result.status === "rejected");
    if (failed?.status === "rejected") throw this.failure ?? failed.reason;
  }

  private async run(): Promise<void> {
    try {
      let position = 0;
      while (
        position < this.pending.length &&
        !this.controller.signal.aborted
      ) {
        const index = this.pending[position];
        if (this.files[index].size > PARALLEL_RANGE_SIZE) {
          await this.downloadFile(position++);
        } else {
          let end = position + 1;
          while (
            end < this.pending.length &&
            this.files[this.pending[end]].size <= PARALLEL_RANGE_SIZE
          )
            end++;
          await this.runSmallFiles(position, end);
          position = end;
        }
      }
      if (!this.controller.signal.aborted) this.status = "complete";
    } catch (error) {
      if (this.status === "paused") return;
      this.stop("error");
      throw error;
    } finally {
      await Promise.allSettled(this.links.values());
      this.links.clear();
    }
  }

  private stop(status: "paused" | "error"): void {
    this.status = status;
    this.controller.abort();
    for (const downloader of this.workers.values()) {
      if (downloader.getDownloadStatus()?.status !== "complete")
        downloader.pauseDownload();
    }
  }

  pauseDownload(): void {
    if (this.status !== "complete") this.stop("paused");
  }

  async waitForIdle(): Promise<void> {
    await this.activeRun?.catch(() => undefined);
  }

  cancelDownload(deleteFile = true): void {
    this.pauseDownload();
    for (const downloader of this.workers.values())
      downloader.cancelDownload(deleteFile);
    this.workers.clear();
  }

  setReconnecting(value: boolean): void {
    this.isReconnecting = value;
    for (const downloader of this.workers.values())
      downloader.setReconnecting(value);
  }

  reconnect(): void {
    for (const downloader of this.workers.values()) downloader.reconnect();
  }

  getFiles(): DownloadFile[] {
    return this.files.map((file, index) => ({
      ...file,
      bytesDownloaded: Math.max(
        file.bytesDownloaded,
        this.workers.get(index)?.getDownloadStatus()?.bytesDownloaded ?? 0
      ),
    }));
  }

  getDownloadStatus(): JsHttpDownloaderStatus {
    const files = this.getFiles();
    const bytesDownloaded = files.reduce(
      (sum, file) => sum + file.bytesDownloaded,
      0
    );
    const fileSize = files.reduce((sum, file) => sum + file.size, 0);
    this.speed = sampleJsBatchSpeed(this.speed, bytesDownloaded, 0, Date.now());
    const statuses = [...this.workers.values()].map((worker) =>
      worker.getDownloadStatus()
    );
    const isRecovering = statuses.some((status) => status?.isRecovering);
    const progress = fileSize ? bytesDownloaded / fileSize : 0;
    return {
      folderName: this.folderName,
      fileSize,
      progress: this.status === "complete" ? 1 : Math.min(progress, 0.9999),
      bytesDownloaded,
      downloadSpeed: this.status === "active" ? this.speed.batchSpeed : 0,
      status: this.status,
      numPeers: 0,
      numSeeds: 0,
      isReconnecting:
        this.isReconnecting ||
        statuses.some((status) => status?.isReconnecting),
      isRecovering,
      recoveryProgress: 0,
      resumeCapability: statuses.some(
        (status) => status?.resumeCapability === "unsupported"
      )
        ? "unsupported"
        : "supported",
    };
  }
}
