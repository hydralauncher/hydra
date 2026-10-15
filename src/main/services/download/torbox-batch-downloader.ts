import { runDownloadQueue } from "./download-work-queue";
import path from "node:path";
import {
  getResourceIdentityState,
  saveCompletedResourceIdentity,
  readRangeState,
  readResourceIdentity,
  rangeResourceId,
} from "./range-download-state";
import type { DownloadFile } from "@types";
import { DownloadThrottle } from "./download-throttle";
import {
  JsHttpDownloader,
  type JsHttpDownloaderOptions,
  type JsHttpDownloaderStatus,
} from "./js-http-downloader";
import {
  sampleJsBatchSpeed,
  INCOMPLETE_BATCH_PROGRESS_LIMIT,
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
    this.files = files.map((file, index) =>
      this.verifyCompletedFile(file, index)
    );
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

  private verifyCompletedFile(file: DownloadFile, index: number): DownloadFile {
    if (!file.completed || !file.size) return { ...file };
    const options = this.getOptions(index, "about:blank");
    const filename = path.join(options.savePath, options.filename!);
    const identity = options.resourceId
      ? getResourceIdentityState(filename, options.resourceId)
      : "unidentified";
    if (identity === "complete") return { ...file };
    // Interrupted finalization retains provenance and must pass the downloader's saved-byte checks.
    const ranges = readRangeState(filename);
    if (
      identity !== "changed" &&
      (identity === "identified" ||
        ranges?.resourceId === rangeResourceId(options.resourceId))
    )
      return { ...file, completed: false };
    throw new Error(
      "The existing completed file has no matching verified identity. Keeping the saved file."
    );
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
    options.beforeComplete = (filename) =>
      saveCompletedResourceIdentity(filename, options.resourceId!);
    // New files record provenance before writing; unidentified legacy partials keep overlap verification.
    options.requireResourceIdentity =
      file.bytesDownloaded === 0 ||
      readResourceIdentity(path.join(options.savePath, options.filename!)) !==
        null;
    options.allowParallelRanges = true;
    options.parallelRangeConnections =
      file.size > PARALLEL_RANGE_SIZE ? PARALLEL_RANGE_COUNT : 1;
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
    const runWorker = () =>
      runDownloadQueue(
        () => (position < end ? this.downloadFile(position++) : undefined),
        this.controller.signal
      ).catch((error: unknown) => {
        if (!this.controller.signal.aborted) {
          this.failure = error;
          this.stop("error");
        }
        throw error;
      });
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
      await runDownloadQueue(() => {
        if (position >= this.pending.length) return undefined;
        const index = this.pending[position];
        if (this.files[index].size > PARALLEL_RANGE_SIZE)
          return this.downloadFile(position++);
        const start = position;
        while (
          position < this.pending.length &&
          this.files[this.pending[position]].size <= PARALLEL_RANGE_SIZE
        )
          position++;
        return this.runSmallFiles(start, position);
      }, this.controller.signal);
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
      progress:
        this.status === "complete"
          ? 1
          : Math.min(progress, INCOMPLETE_BATCH_PROGRESS_LIMIT),
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
