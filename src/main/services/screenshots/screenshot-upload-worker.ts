import axios from "axios";
import fs from "node:fs";
import { randomUUID } from "node:crypto";
import { gamesSublevel, levelKeys } from "@main/level";
import type {
  LocalScreenshot,
  LocalScreenshotUploadOptions,
  ScreenshotModerationState,
  ScreenshotPresignRequest,
  ScreenshotPresignResponse,
  ScreenshotQuality,
  ScreenshotUploadProgress,
} from "@types";

import { GAME_NOT_FOUND_ERROR_CODE } from "../achievements/grouped-souvenir-retry-policy";
import type { HydraApiAuthContext } from "../hydra-auth-context";
import { HydraApi } from "../hydra-api";
import { logger } from "../logger";
import { WindowManager } from "../window-manager";
import { GameContentWarningCache } from "./content-warning-cache";
import { LocalScreenshotStore } from "./local-screenshot-store";
import { compressScreenshotForUpload } from "./screenshot-compression";
import { ScreenshotReviewWindows } from "./screenshot-review-windows";
import { ScreenshotTelemetry } from "./screenshot-telemetry";
import { ScreenshotUploadNotifier } from "./screenshot-upload-notifier";
import {
  getScreenshotUploadFailure,
  planScreenshotUploadRecovery,
  type ScreenshotUploadFailure,
} from "./screenshot-upload-retry-policy";

const PROGRESS_THROTTLE_MS = 150;
const REQUEST_TIMEOUT_MS = 30_000;
const UPLOAD_TIMEOUT_MS = 5 * 60_000;
const IMAGE_PROGRESS_SHARE = 0.9;
const THUMBNAIL_PROGRESS_SHARE = 0.07;
const STATUS_POLL_INTERVAL_MS = 5 * 60_000;
const STATUS_POLL_MAX_AGE_MS = 24 * 60 * 60_000;
const MAX_STATUS_POLLS_PER_RUN = 10;
const SETTLED_REFRESH_INTERVAL_MS = 2 * 60_000;
const MIN_SCHEDULED_RUN_DELAY_MS = 1_000;
const FAST_MODERATION_POLL_DELAYS_MS = [
  10_000, 10_000, 15_000, 20_000, 30_000, 45_000, 60_000,
];

class UploadPutError extends Error {
  constructor(cause: unknown) {
    super("screenshot_upload_failed");
    this.name = "UploadPutError";
    this.cause = cause;
  }
}

const MODERATION_STATUSES = new Set<string>(["PENDING", "APPROVED", "BLOCKED"]);

const isModerationStatus = (
  value: unknown
): value is ScreenshotModerationState["moderationStatus"] =>
  typeof value === "string" && MODERATION_STATUSES.has(value);

const isActiveUploadState = (state: LocalScreenshot["state"]) =>
  state === "queued" || state === "uploading";

const emitProgress = (progress: ScreenshotUploadProgress) => {
  WindowManager.sendToAppWindows("on-screenshot-upload-progress", progress);
  ScreenshotReviewWindows.broadcast("on-screenshot-upload-progress", progress);
};

const buildPresignRequest = (
  screenshot: LocalScreenshot,
  uploadClientId: string,
  quality: ScreenshotQuality,
  image: { length: number; width: number; height: number },
  thumbnailLength: number
): ScreenshotPresignRequest => {
  const isCustom = screenshot.shop === "custom";
  const customGameTitle = screenshot.customGameTitle?.trim();

  return {
    clientId: uploadClientId,
    quality,
    imageLength: image.length,
    thumbnailLength,
    width: image.width,
    height: image.height,
    shop: screenshot.shop,
    ...(isCustom || !screenshot.objectId
      ? {}
      : { objectId: screenshot.objectId }),
    ...(isCustom && customGameTitle ? { customGameTitle } : {}),
    capturedAt: screenshot.capturedAt,
    isSpoiler: screenshot.isSpoiler,
    visibility: screenshot.visibility,
  };
};

const putObject = async (
  url: string,
  body: Buffer,
  signal: AbortSignal,
  onProgress: (fraction: number) => void
) => {
  try {
    await axios.put(url, body, {
      headers: { "Content-Type": "image/jpeg" },
      maxBodyLength: Infinity,
      maxContentLength: Infinity,
      timeout: UPLOAD_TIMEOUT_MS,
      signal,
      onUploadProgress: (event) => {
        const total = event.total ?? body.byteLength;
        if (total > 0) onProgress(Math.min(1, event.loaded / total));
      },
    });
  } catch (error) {
    if (axios.isCancel(error)) throw error;
    throw new UploadPutError(error);
  }
};

const hasSyncedGame = async (screenshot: LocalScreenshot) => {
  if (screenshot.shop === "custom" || !screenshot.objectId) return true;

  const game = await gamesSublevel
    .get(levelKeys.game(screenshot.shop, screenshot.objectId))
    .catch(() => null);
  return Boolean(game?.remoteId);
};

const getCurrentOwnerId = () => HydraApi.getAuthContext()?.userId ?? null;

class ScreenshotUploadWorker {
  private running: Promise<void> | null = null;
  private rerunRequested = false;
  private retryTimer: ReturnType<typeof setTimeout> | null = null;
  private activeUpload: {
    clientId: string;
    controller: AbortController;
  } | null = null;
  private readonly gameWaits = new Map<string, number>();
  private readonly fastModerationPolls = new Map<
    string,
    ReturnType<typeof setTimeout>
  >();
  private lastSettledRefreshAt = 0;
  private readonly moderationCheckedAt = new Map<string, number>();
  private lastOwnerId: string | null = null;
  private authListenerRegistered = false;

  public start() {
    if (!this.authListenerRegistered) {
      this.authListenerRegistered = true;
      HydraApi.onAuthContextChanged(() => this.handleAuthContextChange());
    }
    this.lastOwnerId = getCurrentOwnerId();
    void this.resetInterruptedUploads()
      .then(() => this.trigger())
      .then(() => this.refreshSettledModerationStatuses());
  }

  public async enqueue(
    clientId: string,
    options: LocalScreenshotUploadOptions
  ) {
    const ownerId = getCurrentOwnerId();
    if (!ownerId || !HydraApi.isLoggedIn()) {
      throw new Error("user not logged in");
    }

    const screenshot = await LocalScreenshotStore.get(clientId);
    if (!screenshot) throw new Error("screenshot_missing");
    if (screenshot.ownerId && screenshot.ownerId !== ownerId) {
      throw new Error("screenshot_owner_mismatch");
    }
    if (isActiveUploadState(screenshot.state)) return screenshot;
    if (screenshot.state === "uploaded") return screenshot;

    this.gameWaits.delete(clientId);
    const updated = await LocalScreenshotStore.update(clientId, {
      ownerId,
      state: "queued",
      isSpoiler: options.isSpoiler,
      visibility: options.visibility,
      customGameTitle:
        screenshot.shop === "custom"
          ? options.customGameTitle?.trim() || null
          : screenshot.customGameTitle,
      uploadProgress: 0,
      uploadAttempts: 0,
      nextUploadAttemptAt: null,
      lastError: null,
    });

    emitProgress({ clientId, state: "queued", progress: 0 });
    ScreenshotTelemetry.record("review", "upload");
    void this.trigger();
    return updated;
  }

  public cancel(clientId: string) {
    if (this.activeUpload?.clientId === clientId) {
      this.activeUpload.controller.abort();
    }
    this.gameWaits.delete(clientId);
  }

  public trigger() {
    if (this.retryTimer) {
      clearTimeout(this.retryTimer);
      this.retryTimer = null;
    }

    if (this.running !== null) {
      this.rerunRequested = true;
      return this.running;
    }

    this.running = this.run()
      .catch((error) => {
        logger.error("Screenshot upload worker failed", error);
      })
      .finally(() => {
        this.running = null;
        if (this.rerunRequested) {
          this.rerunRequested = false;
          void this.trigger();
          return;
        }
        void this.scheduleNextRun();
      });

    return this.running;
  }

  public stop() {
    if (this.retryTimer) clearTimeout(this.retryTimer);
    this.retryTimer = null;
    for (const timer of this.fastModerationPolls.values()) clearTimeout(timer);
    this.fastModerationPolls.clear();
    this.activeUpload?.controller.abort();
  }

  public async handleModerationResult(result: ScreenshotModerationState) {
    const screenshot = await LocalScreenshotStore.findByScreenshotId(result.id);
    if (!screenshot) return;

    await LocalScreenshotStore.update(screenshot.clientId, {
      moderationStatus: result.moderationStatus,
      moderationReason: result.moderationReason ?? null,
    });
  }

  private handleAuthContextChange() {
    const ownerId = getCurrentOwnerId();
    if (ownerId === this.lastOwnerId) return;
    this.lastOwnerId = ownerId;

    this.stop();
    if (ownerId) void this.trigger();
  }

  private async resetInterruptedUploads() {
    const screenshots = await LocalScreenshotStore.list();
    for (const screenshot of screenshots) {
      if (screenshot.state !== "uploading") continue;
      await LocalScreenshotStore.update(screenshot.clientId, {
        state: "queued",
        uploadProgress: 0,
      });
    }
  }

  private async run() {
    const ownerId = getCurrentOwnerId();
    if (!ownerId || !HydraApi.isLoggedIn()) return;
    const authContext = HydraApi.getAuthContext();
    if (!authContext) return;

    const screenshots = await LocalScreenshotStore.list();
    const queued = screenshots
      .filter(
        (screenshot) =>
          screenshot.ownerId === ownerId && screenshot.state === "queued"
      )
      .toSorted((a, b) => a.capturedAt - b.capturedAt);

    for (const screenshot of queued) {
      if (!HydraApi.isAuthContextCurrent(authContext)) return;
      if ((screenshot.nextUploadAttemptAt ?? 0) > Date.now()) continue;

      const current = await LocalScreenshotStore.get(screenshot.clientId);
      if (current?.state !== "queued" || current.ownerId !== ownerId) continue;

      await this.process(current, authContext);
    }

    await this.pollModerationStatuses(ownerId, authContext);
    await ScreenshotUploadNotifier.refresh();
  }

  private async process(
    screenshot: LocalScreenshot,
    authContext: HydraApiAuthContext
  ) {
    const { clientId } = screenshot;
    const controller = new AbortController();
    this.activeUpload = { clientId, controller };

    const quality: ScreenshotQuality =
      screenshot.uploadQuality ??
      (HydraApi.hasActiveSubscription() ? "CLOUD" : "STANDARD");
    const uploadClientId = screenshot.uploadClientId ?? clientId;
    const attempt = (screenshot.uploadAttempts ?? 0) + 1;

    let lastProgressAt = 0;
    const reportProgress = (progress: number, force = false) => {
      const now = Date.now();
      if (!force && now - lastProgressAt < PROGRESS_THROTTLE_MS) return;
      lastProgressAt = now;
      emitProgress({ clientId, state: "uploading", progress });
    };

    await LocalScreenshotStore.update(clientId, {
      state: "uploading",
      uploadAttempts: attempt,
      uploadProgress: 0,
      uploadQuality: quality,
      uploadClientId,
      lastError: null,
    });
    reportProgress(0, true);

    try {
      if (!(await hasSyncedGame(screenshot))) {
        throw new Error(GAME_NOT_FOUND_ERROR_CODE);
      }

      const original = await fs.promises.readFile(screenshot.path);
      const compressed = await compressScreenshotForUpload(original, quality);
      if (controller.signal.aborted) throw new axios.CanceledError();

      const presign = await HydraApi.post<ScreenshotPresignResponse>(
        "/presigned-urls/screenshot",
        buildPresignRequest(
          screenshot,
          uploadClientId,
          compressed.quality,
          {
            length: compressed.image.byteLength,
            width: compressed.width,
            height: compressed.height,
          },
          compressed.thumbnail.byteLength
        ),
        { authContext, signal: controller.signal, timeout: REQUEST_TIMEOUT_MS }
      );

      await putObject(
        presign.presignedUrl,
        compressed.image,
        controller.signal,
        (fraction) => reportProgress(fraction * IMAGE_PROGRESS_SHARE)
      );
      await putObject(
        presign.thumbnailPresignedUrl,
        compressed.thumbnail,
        controller.signal,
        (fraction) =>
          reportProgress(
            IMAGE_PROGRESS_SHARE + fraction * THUMBNAIL_PROGRESS_SHARE
          )
      );

      const result = await HydraApi.post<ScreenshotModerationState>(
        `/profile/screenshots/${encodeURIComponent(presign.id)}/complete`,
        undefined,
        { authContext, signal: controller.signal, timeout: REQUEST_TIMEOUT_MS }
      );

      this.gameWaits.delete(clientId);
      const moderationStatus = isModerationStatus(result?.moderationStatus)
        ? result.moderationStatus
        : "PENDING";
      await LocalScreenshotStore.update(clientId, {
        state: "uploaded",
        screenshotId: presign.id,
        moderationStatus,
        moderationReason: result?.moderationReason ?? null,
        uploadProgress: 1,
        uploadedAt: Date.now(),
        nextUploadAttemptAt: null,
        lastError: null,
      });
      emitProgress({ clientId, state: "uploaded", progress: 1 });
      if (moderationStatus === "PENDING") {
        this.scheduleFastModerationPoll(clientId);
      }
      ScreenshotTelemetry.record("upload", "uploaded", compressed.quality);
    } catch (error) {
      await this.handleFailure(screenshot, quality, attempt, error, controller);
    } finally {
      if (this.activeUpload?.controller === controller)
        this.activeUpload = null;
    }
  }

  private async handleFailure(
    screenshot: LocalScreenshot,
    quality: ScreenshotQuality,
    attempt: number,
    error: unknown,
    controller: AbortController
  ) {
    const { clientId } = screenshot;
    const current = await LocalScreenshotStore.get(clientId);
    if (!current) return;

    if (controller.signal.aborted || axios.isCancel(error)) {
      if (current.state === "uploading") {
        await LocalScreenshotStore.update(clientId, {
          state: "queued",
          uploadProgress: 0,
          uploadAttempts: Math.max(0, attempt - 1),
        });
      }
      return;
    }

    const failure = getScreenshotUploadFailure(error);
    const gameWaits = this.gameWaits.get(clientId) ?? 0;
    if (failure.action === "wait_for_game") {
      this.gameWaits.set(clientId, gameWaits + 1);
    }

    if (failure.code === "screenshots/disabled-for-game" && current.objectId) {
      GameContentWarningCache.markAdult(current.shop, current.objectId);
    }

    const step = planScreenshotUploadRecovery(
      failure,
      { uploadAttempts: attempt, gameWaits },
      quality
    );

    logger.warn("Screenshot upload failed", {
      clientId,
      code: failure.code,
      action: failure.action,
      step: step.kind,
    });

    if (step.kind === "stopped") {
      await LocalScreenshotStore.update(clientId, {
        state: "queued",
        uploadProgress: 0,
        uploadAttempts: Math.max(0, attempt - 1),
      });
      return;
    }

    if (step.kind === "failed") {
      await this.markFailed(clientId, failure);
      return;
    }

    if (step.kind === "retry_now") {
      await LocalScreenshotStore.update(clientId, {
        state: "queued",
        uploadProgress: 0,
        lastError: failure.code,
        nextUploadAttemptAt: null,
        ...(step.quality ? { uploadQuality: step.quality } : {}),
        ...(step.rotateClientId ? { uploadClientId: randomUUID() } : {}),
      });
      emitProgress({ clientId, state: "queued", progress: 0 });
      this.rerunRequested = true;
      return;
    }

    await LocalScreenshotStore.update(clientId, {
      state: "queued",
      uploadProgress: 0,
      lastError: failure.code,
      nextUploadAttemptAt: Date.now() + step.delay,
      uploadAttempts: step.countsAsAttempt ? attempt : Math.max(0, attempt - 1),
    });
    emitProgress({ clientId, state: "queued", progress: 0 });
  }

  private async markFailed(clientId: string, failure: ScreenshotUploadFailure) {
    this.gameWaits.delete(clientId);
    await LocalScreenshotStore.update(clientId, {
      state: "failed",
      uploadProgress: null,
      lastError: failure.code,
      nextUploadAttemptAt: null,
    });
    emitProgress({ clientId, state: "failed", progress: null });
    ScreenshotTelemetry.record("upload", "failed", failure.code);
  }

  private async refreshModerationStatus(
    screenshot: LocalScreenshot,
    authContext: HydraApiAuthContext
  ) {
    if (!screenshot.screenshotId) return;
    this.moderationCheckedAt.set(screenshot.clientId, Date.now());

    try {
      const status = await HydraApi.get<ScreenshotModerationState>(
        `/profile/screenshots/${encodeURIComponent(screenshot.screenshotId)}/status`,
        undefined,
        { authContext, timeout: REQUEST_TIMEOUT_MS }
      );
      if (!isModerationStatus(status?.moderationStatus)) return;

      const moderationReason = status.moderationReason ?? null;
      if (
        status.moderationStatus === screenshot.moderationStatus &&
        moderationReason === screenshot.moderationReason
      ) {
        return;
      }

      await LocalScreenshotStore.update(screenshot.clientId, {
        moderationStatus: status.moderationStatus,
        moderationReason,
      });
    } catch (error) {
      logger.warn("Could not refresh the screenshot moderation status", {
        clientId: screenshot.clientId,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  private async pollModerationStatuses(
    ownerId: string,
    authContext: HydraApiAuthContext,
    { includeBlocked = false }: { includeBlocked?: boolean } = {}
  ) {
    const now = Date.now();
    const candidates = (await LocalScreenshotStore.list())
      .filter(
        (screenshot) =>
          screenshot.ownerId === ownerId &&
          screenshot.state === "uploaded" &&
          screenshot.screenshotId &&
          ((screenshot.moderationStatus === "PENDING" &&
            now - (screenshot.uploadedAt ?? 0) < STATUS_POLL_MAX_AGE_MS) ||
            (includeBlocked && screenshot.moderationStatus === "BLOCKED"))
      )
      .toSorted(
        (a, b) =>
          (this.moderationCheckedAt.get(a.clientId) ?? 0) -
            (this.moderationCheckedAt.get(b.clientId) ?? 0) ||
          (b.uploadedAt ?? 0) - (a.uploadedAt ?? 0)
      )
      .slice(0, MAX_STATUS_POLLS_PER_RUN);

    for (const screenshot of candidates) {
      if (!HydraApi.isAuthContextCurrent(authContext)) return;
      await this.refreshModerationStatus(screenshot, authContext);
    }
  }

  public async refreshSettledModerationStatuses() {
    if (Date.now() - this.lastSettledRefreshAt < SETTLED_REFRESH_INTERVAL_MS) {
      return;
    }
    const authContext = HydraApi.getAuthContext();
    if (!authContext || !HydraApi.isLoggedIn()) return;

    this.lastSettledRefreshAt = Date.now();
    await this.pollModerationStatuses(authContext.userId, authContext, {
      includeBlocked: true,
    });
  }

  private scheduleFastModerationPoll(clientId: string, step = 0) {
    const existing = this.fastModerationPolls.get(clientId);
    if (existing) clearTimeout(existing);
    this.fastModerationPolls.delete(clientId);

    const delay = FAST_MODERATION_POLL_DELAYS_MS[step];
    if (delay === undefined) return;

    const timer = setTimeout(() => {
      this.fastModerationPolls.delete(clientId);
      void this.runFastModerationPoll(clientId, step);
    }, delay);
    timer.unref?.();
    this.fastModerationPolls.set(clientId, timer);
  }

  private async runFastModerationPoll(clientId: string, step: number) {
    const screenshot = await LocalScreenshotStore.get(clientId);
    const authContext = HydraApi.getAuthContext();
    if (
      !screenshot ||
      !authContext ||
      screenshot.ownerId !== authContext.userId ||
      screenshot.state !== "uploaded" ||
      screenshot.moderationStatus !== "PENDING" ||
      !ScreenshotReviewWindows.isScreenshotWatched(clientId)
    ) {
      return;
    }

    await this.refreshModerationStatus(screenshot, authContext);
    this.scheduleFastModerationPoll(clientId, step + 1);
  }

  private async scheduleNextRun() {
    const ownerId = getCurrentOwnerId();
    if (!ownerId) return;

    const now = Date.now();
    const screenshots = await LocalScreenshotStore.list();
    const owned = screenshots.filter(
      (screenshot) => screenshot.ownerId === ownerId
    );
    const nextRetryAt = owned
      .filter((screenshot) => screenshot.state === "queued")
      .map((screenshot) => screenshot.nextUploadAttemptAt ?? now)
      .toSorted((a, b) => a - b)[0];
    const hasPendingModeration = owned.some(
      (screenshot) =>
        screenshot.state === "uploaded" &&
        screenshot.moderationStatus === "PENDING" &&
        now - (screenshot.uploadedAt ?? 0) < STATUS_POLL_MAX_AGE_MS
    );

    const candidates = [
      nextRetryAt,
      hasPendingModeration ? now + STATUS_POLL_INTERVAL_MS : undefined,
    ].filter((value): value is number => value !== undefined);
    if (!candidates.length) return;

    const delay = Math.max(
      MIN_SCHEDULED_RUN_DELAY_MS,
      Math.min(...candidates) - now
    );
    this.retryTimer = setTimeout(() => void this.trigger(), delay);
    this.retryTimer.unref?.();
  }
}

export const screenshotUploadWorker = new ScreenshotUploadWorker();
