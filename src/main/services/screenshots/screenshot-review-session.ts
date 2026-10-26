import type { LocalScreenshot, ScreenshotReview } from "@types";

import { WindowManager } from "../window-manager";
import { LocalScreenshotStore } from "./local-screenshot-store";

export interface ScreenshotReviewTarget {
  shop: LocalScreenshot["shop"];
  objectId: string;
  clientIds: string[];
  selectedClientId: string;
}

let desktopReview: ScreenshotReview | null = null;
const closedListeners = new Set<() => void>();

const sendDesktopReview = () => {
  const mainWindow = WindowManager.mainWindow;
  if (!mainWindow || mainWindow.isDestroyed()) return;
  mainWindow.webContents.send("on-screenshot-review-changed", desktopReview);
};

const releaseUnreviewedScreenshots = async (clientIds: string[]) => {
  await Promise.all(
    clientIds.map((clientId) =>
      LocalScreenshotStore.update(clientId, (current) =>
        current.state === "reviewing" ? { state: "local" } : {}
      )
    )
  );
};

const markAsReviewing = (clientIds: string[]) =>
  Promise.all(
    clientIds.map((clientId) =>
      LocalScreenshotStore.update(clientId, (current) =>
        current.state === "local" ? { state: "reviewing" } : {}
      )
    )
  );

export class ScreenshotReviewSession {
  public static async releaseStaleReviews(startedAt: number) {
    const screenshots = await LocalScreenshotStore.list();
    const stale = screenshots
      .filter(
        (screenshot) =>
          screenshot.state === "reviewing" && screenshot.capturedAt < startedAt
      )
      .map(({ clientId }) => clientId);
    await releaseUnreviewedScreenshots(stale);
    return stale.length;
  }

  public static async open(target: ScreenshotReviewTarget) {
    if (!target.clientIds.length) return;

    await markAsReviewing(target.clientIds);

    const removedIds =
      desktopReview?.clientIds.filter(
        (clientId) => !target.clientIds.includes(clientId)
      ) ?? [];
    desktopReview = {
      clientIds: target.clientIds,
      selectedClientId: target.selectedClientId,
    };
    await releaseUnreviewedScreenshots(removedIds);
    sendDesktopReview();
  }

  public static async close() {
    if (!desktopReview) return;

    const { clientIds } = desktopReview;
    desktopReview = null;
    sendDesktopReview();
    await releaseUnreviewedScreenshots(clientIds);
    for (const listener of closedListeners) listener();
  }

  public static getDesktopReview() {
    return desktopReview
      ? { ...desktopReview, clientIds: [...desktopReview.clientIds] }
      : null;
  }

  public static isReviewing(clientId: string) {
    return desktopReview?.clientIds.includes(clientId) ?? false;
  }

  public static isScreenshotUnderReview(clientId: string) {
    const mainWindow = WindowManager.mainWindow;
    return (
      this.isReviewing(clientId) &&
      !!mainWindow &&
      !mainWindow.isDestroyed() &&
      mainWindow.isVisible() &&
      !mainWindow.isMinimized()
    );
  }

  public static onClosed(listener: () => void) {
    closedListeners.add(listener);
    return () => {
      closedListeners.delete(listener);
    };
  }

  public static async removeScreenshot(clientId: string) {
    if (!desktopReview?.clientIds.includes(clientId)) return;

    const clientIds = desktopReview.clientIds.filter(
      (candidate) => candidate !== clientId
    );
    if (!clientIds.length) {
      await this.close();
      return;
    }

    desktopReview = {
      clientIds,
      selectedClientId:
        desktopReview.selectedClientId === clientId
          ? null
          : desktopReview.selectedClientId,
    };
    sendDesktopReview();
  }

  public static async releaseBigPictureReview(clientIds: string[]) {
    await releaseUnreviewedScreenshots(clientIds);
  }
}
