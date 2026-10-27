import { Notification } from "electron";
import { t } from "i18next";
import icon from "@resources/icon.png?asset";
import type { LocalScreenshot } from "@types";

import { HydraApi } from "../hydra-api";
import { logger } from "../logger";
import { toXmlString } from "../notifications/xml";
import { WindowManager } from "../window-manager";
import { LocalScreenshotStore } from "./local-screenshot-store";

interface UploadBatch {
  clientIds: Set<string>;
  notification: Notification | null;
}

let batch: UploadBatch | null = null;
const userUploadClientIds = new Set<string>();

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

const isMainWindowWatched = () => {
  const mainWindow = WindowManager.mainWindow;
  return (
    !!mainWindow &&
    !mainWindow.isDestroyed() &&
    mainWindow.isVisible() &&
    !mainWindow.isMinimized() &&
    mainWindow.isFocused()
  );
};

const pruneUserUploads = (byClientId: Map<string, LocalScreenshot>) => {
  for (const clientId of userUploadClientIds) {
    const isActive = isActiveState(byClientId.get(clientId)?.state);
    if (!isActive && !batch?.clientIds.has(clientId)) {
      userUploadClientIds.delete(clientId);
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
    userUploadClientIds.delete(clientId);
  }
  batch = null;

  showBatchSummary(
    states.filter((state) => state === "uploaded").length,
    states.filter((state) => state === "failed").length
  );
};

export class ScreenshotUploadNotifier {
  public static markUserUpload(clientId: string) {
    userUploadClientIds.add(clientId);
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
    const isWatched = isMainWindowWatched();
    const unattended = screenshots.filter(
      (screenshot) =>
        userUploadClientIds.has(screenshot.clientId) &&
        screenshot.ownerId === ownerId &&
        isActiveState(screenshot.state) &&
        !isWatched
    );

    pruneUserUploads(byClientId);

    if (!batch) {
      if (unattended.length) startBatch(unattended);
      return;
    }

    for (const { clientId } of unattended) batch.clientIds.add(clientId);
    finishBatchIfSettled(batch, byClientId);
  }
}
