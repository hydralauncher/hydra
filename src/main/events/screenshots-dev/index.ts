import { app } from "electron";
import type {
  GameShop,
  LocalScreenshot,
  ScreenshotsDevBurstRequest,
  ScreenshotsDevCaptureRequest,
  ScreenshotsDevFeedbackKind,
  ScreenshotsDevInputResult,
  ScreenshotsDevModerationOutcome,
  ScreenshotsDevResult,
  ScreenshotsDevUploadFailure,
} from "@types";

import { logger } from "@main/services/logger";
import { ScreenshotInputService } from "@main/services/screenshot-input";
import {
  deleteLocalScreenshot,
  LocalScreenshotStore,
  ScreenshotReviewSession,
  screenshotUploadWorker,
} from "@main/services/screenshots";
import { ScreenshotFeedback } from "@main/services/screenshots/screenshot-feedback";
import { registerEvent } from "../register-event";
import {
  createDevThumbnail,
  listDevGames,
  simulateCapture,
  simulateGameClosed,
} from "./dev-captures";

const BURST_INTERVAL_MS = 30;
const MAX_BURST_COUNT = 8;

const failed = (error: unknown): ScreenshotsDevResult => {
  logger.error("Screenshot dev tool failed", error);
  return { ok: false, error: "failed" };
};

const run = async (
  task: () => Promise<ScreenshotsDevResult>
): Promise<ScreenshotsDevResult> => {
  try {
    return await task();
  } catch (error) {
    return failed(error);
  }
};

const wait = (delay: number) =>
  new Promise((resolve) => {
    setTimeout(resolve, delay);
  });

const apiError = (status: number, data: Record<string, unknown>) =>
  Object.assign(
    new Error(
      typeof data.message === "string" ? data.message : `HTTP ${status}`
    ),
    {
      isAxiosError: true,
      response: { status, data },
    }
  );

const buildUploadFailure = (
  failure: ScreenshotsDevUploadFailure,
  screenshot: LocalScreenshot
) => {
  switch (failure) {
    case "tier_limit":
      return apiError(400, { message: "screenshots/exceeds-tier-limit" });
    case "disabled_for_game":
      return apiError(403, { message: "screenshots/disabled-for-game" });
    case "limit_reached":
      return apiError(400, { message: "screenshots/limit-reached" });
    case "blocked_limit_reached":
      return apiError(403, { message: "screenshots/blocked-limit-reached" });
    case "game_not_found":
      return apiError(404, { message: "game/not-found" });
    case "already_uploaded":
      return apiError(409, {
        message: "screenshots/already-uploaded",
        id: screenshot.screenshotId ?? `dev-${screenshot.clientId}`,
        moderationStatus: "PENDING",
        moderationReason: null,
      });
    case "network":
      return Object.assign(new Error("Network Error"), {
        isAxiosError: true,
        code: "ERR_NETWORK",
      });
  }
};

const getModerationReason = (
  outcome: ScreenshotsDevModerationOutcome,
  reason: string | null
) => {
  if (outcome === "WITHHELD") return "blocked";
  if (outcome === "BLOCKED") return reason;
  return null;
};

const playFeedback = async (kind: ScreenshotsDevFeedbackKind) => {
  if (kind === "sound") {
    await ScreenshotFeedback.playCaptureFeedback({
      playSound: true,
      flash: false,
    });
    return;
  }

  if (kind === "flash") {
    await ScreenshotFeedback.playCaptureFeedback({
      playSound: false,
      flash: true,
    });
    return;
  }

  const gameTitle = "Hydra";
  if (kind === "disabled_for_game") {
    await ScreenshotFeedback.showToast(
      { kind, gameTitle },
      { ignorePreference: true }
    );
    return;
  }

  await ScreenshotFeedback.showToast(
    { kind, gameTitle, thumbnailPath: await createDevThumbnail(gameTitle) },
    { ignorePreference: true }
  );
};

const registerScreenshotsDevEvents = () => {
  registerEvent("screenshotsDevListGames", () => listDevGames());

  registerEvent(
    "screenshotsDevCapture",
    (
      _event: Electron.IpcMainInvokeEvent,
      request: ScreenshotsDevCaptureRequest
    ) =>
      run(async () => {
        await simulateCapture(request);
        return { ok: true, count: request.adult ? 0 : 1 };
      })
  );

  registerEvent(
    "screenshotsDevBurst",
    (
      _event: Electron.IpcMainInvokeEvent,
      request: ScreenshotsDevBurstRequest
    ) =>
      run(async () => {
        const count = Math.min(
          MAX_BURST_COUNT,
          Math.max(1, Math.round(request.count))
        );
        const captures = Array.from({ length: count }, async (_, index) => {
          await wait(index * BURST_INTERVAL_MS);
          return simulateCapture(request);
        });
        await Promise.all(captures);
        return { ok: true, count };
      })
  );

  registerEvent(
    "screenshotsDevCloseGame",
    (_event: Electron.IpcMainInvokeEvent, shop: GameShop, objectId: string) =>
      run(() => {
        simulateGameClosed(shop, objectId);
        return Promise.resolve({ ok: true });
      })
  );

  registerEvent(
    "screenshotsDevFeedback",
    (_event: Electron.IpcMainInvokeEvent, kind: ScreenshotsDevFeedbackKind) =>
      run(async () => {
        await playFeedback(kind);
        return { ok: true };
      })
  );

  registerEvent(
    "screenshotsDevModeration",
    (
      _event: Electron.IpcMainInvokeEvent,
      clientId: string,
      outcome: ScreenshotsDevModerationOutcome,
      reason: string | null
    ) =>
      run(async () => {
        const screenshot = await LocalScreenshotStore.get(clientId);
        if (!screenshot) return { ok: false, error: "not_found" };
        if (!screenshot.screenshotId)
          return { ok: false, error: "not_uploaded" };

        await screenshotUploadWorker.handleModerationResult({
          id: screenshot.screenshotId,
          moderationStatus: outcome === "APPROVED" ? "APPROVED" : "BLOCKED",
          moderationReason: getModerationReason(outcome, reason),
        });
        return { ok: true };
      })
  );

  registerEvent(
    "screenshotsDevUploadFailure",
    (
      _event: Electron.IpcMainInvokeEvent,
      clientId: string,
      failure: ScreenshotsDevUploadFailure
    ) =>
      run(async () => {
        const screenshot = await LocalScreenshotStore.get(clientId);
        if (!screenshot) return { ok: false, error: "not_found" };

        await screenshotUploadWorker.applyUploadFailure(
          clientId,
          buildUploadFailure(failure, screenshot)
        );
        return { ok: true };
      })
  );

  registerEvent(
    "screenshotsDevTriggerInput",
    (): ScreenshotsDevInputResult => ({
      triggered: ScreenshotInputService.trigger("deeplink"),
      status: ScreenshotInputService.refreshStatus(),
    })
  );

  registerEvent("screenshotsDevInputStatus", () =>
    ScreenshotInputService.refreshStatus()
  );

  registerEvent(
    "screenshotsDevBigPicture",
    (_event: Electron.IpcMainInvokeEvent, clientIds: string[]) =>
      run(async () => {
        const records = (
          await Promise.all(
            clientIds.map((clientId) => LocalScreenshotStore.get(clientId))
          )
        ).filter((record): record is LocalScreenshot => record !== null);
        const first = records[0];
        if (!first) return { ok: false, error: "not_found" };

        const sent = await ScreenshotReviewSession.requestBigPictureReview({
          gameKey: `${first.shop}:${first.objectId ?? ""}`,
          shop: first.shop,
          objectId: first.objectId ?? "",
          gameTitle: first.gameTitle,
          clientIds: records.map(({ clientId }) => clientId),
        });
        return sent
          ? { ok: true, count: records.length }
          : { ok: false, error: "big_picture_closed" };
      })
  );

  registerEvent("screenshotsDevDeleteCaptures", () =>
    run(async () => {
      const devCaptures = (await LocalScreenshotStore.list()).filter(
        (screenshot) => screenshot.isDevCapture
      );
      await Promise.all(
        devCaptures.map((screenshot) =>
          deleteLocalScreenshot(screenshot.clientId)
        )
      );
      return { ok: true, count: devCaptures.length };
    })
  );
};

if (!app.isPackaged) registerScreenshotsDevEvents();
