import { Notification } from "electron";
import { t } from "i18next";
import icon from "@resources/icon.png?asset";
import type { LocalScreenshot } from "@types";

import { HydraApi } from "../hydra-api";
import { logger } from "../logger";
import { toXmlString } from "../notifications/xml";
import { LocalScreenshotStore } from "./local-screenshot-store";
import { ScreenshotReviewSession } from "./screenshot-review-session";

interface UploadBatch {
  clientIds: Set<string>;
  notification: Notification | null;
}

let batch: UploadBatch | null = null;
const reviewOriginClientIds = new Set<string>();

const showNotification = (
  title: string,
  body: string,
  progress?: { value: number; label: string }
) => {
  const options = {
    title,
    body,
    icon,
    silent: true,
    ...(progress
      ? { progress: { value: progress.value, valueOverride: progress.label } }
      : {}),
  };

  try {
    const notification = new Notification({
      ...options,
      toastXml: process.platform === "win32" ? toXmlString(options) : undefined,
    });
    notification.show();
    return notification;
  } catch (error) {
    logger.error("Failed to show the screenshot upload notification", error);
    return null;
  }
};

const isActiveState = (state: LocalScreenshot["state"] | undefined) =>
  state === "queued" || state === "uploading";

const pruneReviewOrigins = (byClientId: Map<string, LocalScreenshot>) => {
  for (const clientId of reviewOriginClientIds) {
    const isActive = isActiveState(byClientId.get(clientId)?.state);
    if (!isActive && !batch?.clientIds.has(clientId)) {
      reviewOriginClientIds.delete(clientId);
    }
  }
};

const startBatch = (unattended: LocalScreenshot[]) => {
  batch = {
    clientIds: new Set(unattended.map(({ clientId }) => clientId)),
    notification: showNotification(
      t("uploading_title", { ns: "screenshots_capture" }),
      t("uploading_body", {
        ns: "screenshots_capture",
        count: unattended.length,
      }),
      {
        value: 0,
        label: t("uploading_progress", {
          ns: "screenshots_capture",
          done: 0,
          total: unattended.length,
        }),
      }
    ),
  };
};

const showBatchSummary = (uploadedCount: number, failedCount: number) => {
  if (failedCount > 0) {
    showNotification(
      t("upload_failed_title", { ns: "screenshots_capture" }),
      t("upload_failed_body", { ns: "screenshots_capture", count: failedCount })
    );
    return;
  }

  if (uploadedCount > 0) {
    showNotification(
      t("uploaded_title", { ns: "screenshots_capture" }),
      t("uploaded_body", { ns: "screenshots_capture", count: uploadedCount })
    );
  }
};

const finishBatchIfSettled = (
  currentBatch: UploadBatch,
  byClientId: Map<string, LocalScreenshot>
) => {
  const states = [...currentBatch.clientIds].map(
    (clientId) => byClientId.get(clientId)?.state ?? "deleted"
  );
  if (states.some(isActiveState)) return;

  currentBatch.notification?.close();
  for (const clientId of currentBatch.clientIds) {
    reviewOriginClientIds.delete(clientId);
  }
  batch = null;

  showBatchSummary(
    states.filter((state) => state === "uploaded").length,
    states.filter((state) => state === "failed").length
  );
};

export class ScreenshotUploadNotifier {
  public static markReviewOrigin(clientId: string) {
    reviewOriginClientIds.add(clientId);
  }

  public static async refresh() {
    const ownerId = HydraApi.getAuthContext()?.userId ?? null;
    if (!ownerId) {
      batch?.notification?.close();
      batch = null;
      return;
    }

    const screenshots = await LocalScreenshotStore.list();
    const byClientId = new Map(
      screenshots.map((screenshot) => [screenshot.clientId, screenshot])
    );
    const unattended = screenshots.filter(
      (screenshot) =>
        reviewOriginClientIds.has(screenshot.clientId) &&
        screenshot.ownerId === ownerId &&
        isActiveState(screenshot.state) &&
        !ScreenshotReviewSession.isScreenshotUnderReview(screenshot.clientId)
    );

    pruneReviewOrigins(byClientId);

    if (!batch) {
      if (unattended.length) startBatch(unattended);
      return;
    }

    for (const { clientId } of unattended) batch.clientIds.add(clientId);
    finishBatchIfSettled(batch, byClientId);
  }
}
