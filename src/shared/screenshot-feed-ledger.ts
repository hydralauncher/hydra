import type { ProfileScreenshot } from "@types";

import {
  applyScreenshotFeedWrites,
  isRelativeScreenshotPatch,
  type ScreenshotFeedWrite,
  type ScreenshotPatch,
} from "./screenshot-feed-writes";

export interface ScreenshotFeedRead {
  epoch: number;
  sinceVersion: number;
  startedAt: number;
}

export interface ScreenshotRecountOptions {
  fetchScreenshot: (
    screenshot: ProfileScreenshot
  ) => Promise<ProfileScreenshot | null | undefined>;
  isCurrent: () => boolean;
  applyPatch: (screenshotId: string, patch: ScreenshotPatch) => void;
}

export class ScreenshotFeedLedger {
  private epoch = 0;
  private writeVersion = 0;
  private pendingReads = 0;
  private writes: ScreenshotFeedWrite[] = [];
  private readonly fetchedAt = new Map<string, number>();
  private readonly lastRelativeWrite = new Map<string, number>();

  get hasPendingReads() {
    return this.pendingReads > 0;
  }

  beginRead(): ScreenshotFeedRead {
    this.pendingReads += 1;
    return {
      epoch: this.epoch,
      sinceVersion: this.writeVersion,
      startedAt: performance.now(),
    };
  }

  endRead(read: ScreenshotFeedRead) {
    if (read.epoch !== this.epoch) return;
    this.pendingReads = Math.max(0, this.pendingReads - 1);
    if (this.pendingReads === 0) this.writes = [];
  }

  acceptPage(items: ProfileScreenshot[], read: ScreenshotFeedRead) {
    const merged = applyScreenshotFeedWrites(
      items,
      this.writes,
      read.sinceVersion
    );
    for (const item of merged.items) {
      this.fetchedAt.set(item.id, read.startedAt);
    }
    return {
      ...merged,
      recountItems: merged.items.filter((item) =>
        merged.recountIds.has(item.id)
      ),
    };
  }

  recordWrite(screenshotId: string, patch: ScreenshotPatch | null) {
    this.writeVersion += 1;
    if (patch === null) this.fetchedAt.delete(screenshotId);
    else if (isRelativeScreenshotPatch(patch)) {
      this.lastRelativeWrite.set(screenshotId, this.writeVersion);
    }
    if (this.pendingReads === 0) return;

    this.writes.push({ version: this.writeVersion, screenshotId, patch });
  }

  async recountComments(
    item: ProfileScreenshot,
    options: ScreenshotRecountOptions
  ): Promise<void> {
    const startedVersion = this.writeVersion;
    const fresh = await options.fetchScreenshot(item);
    if (!fresh || !options.isCurrent()) return;

    const lastRelativeWrite = this.lastRelativeWrite.get(item.id) ?? 0;
    if (lastRelativeWrite > startedVersion) {
      return this.recountComments(item, options);
    }

    options.applyPatch(item.id, { commentCount: fresh.commentCount });
  }

  getFetchedAt(screenshotId: string) {
    return this.fetchedAt.get(screenshotId) ?? null;
  }

  cancelReads() {
    this.epoch += 1;
    this.pendingReads = 0;
    this.writes = [];
  }

  reset() {
    this.cancelReads();
    this.fetchedAt.clear();
    this.lastRelativeWrite.clear();
  }
}
