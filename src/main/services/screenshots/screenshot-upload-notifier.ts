import { Notification } from "electron";
import { t } from "i18next";
import icon from "@resources/icon.png?asset";

import { HydraApi } from "../hydra-api";
import { logger } from "../logger";
import { toXmlString } from "../notifications/xml";
import { LocalScreenshotStore } from "./local-screenshot-store";
import { ScreenshotReviewWindows } from "./screenshot-review-windows";

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
        (screenshot.state === "queued" || screenshot.state === "uploading") &&
        !ScreenshotReviewWindows.isScreenshotUnderReview(screenshot.clientId)
    );

    for (const clientId of reviewOriginClientIds) {
      const state = byClientId.get(clientId)?.state;
      if (state !== "queued" && state !== "uploading") {
        if (!batch?.clientIds.has(clientId)) {
          reviewOriginClientIds.delete(clientId);
        }
      }
    }

    if (!batch) {
      if (!unattended.length) return;
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
      return;
    }

    for (const { clientId } of unattended) batch.clientIds.add(clientId);

    const states = [...batch.clientIds].map(
      (clientId) => byClientId.get(clientId)?.state ?? "deleted"
    );
    const stillActive = states.some(
      (state) => state === "queued" || state === "uploading"
    );
    if (stillActive) return;

    const uploadedCount = states.filter((state) => state === "uploaded").length;
    const failedCount = states.filter((state) => state === "failed").length;
    batch.notification?.close();
    for (const clientId of batch.clientIds) {
      reviewOriginClientIds.delete(clientId);
    }
    batch = null;

    if (failedCount > 0) {
      showNotification(
        t("upload_failed_title", { ns: "screenshots_capture" }),
        t("upload_failed_body", {
          ns: "screenshots_capture",
          count: failedCount,
        })
      );
      return;
    }

    if (uploadedCount > 0) {
      showNotification(
        t("uploaded_title", { ns: "screenshots_capture" }),
        t("uploaded_body", { ns: "screenshots_capture", count: uploadedCount })
      );
    }
  }
}
