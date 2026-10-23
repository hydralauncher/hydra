import { BrowserWindow, app, screen } from "electron";
import path from "node:path";
import icon from "@resources/icon.png?asset";
import { isStaging } from "@main/constants";
import type { LocalScreenshot, ScreenshotReviewRequest } from "@types";

import { WindowManager } from "../window-manager";
import { LocalScreenshotStore } from "./local-screenshot-store";
import { getCascadedReviewWindowBounds } from "./screenshot-review-window-bounds";

const REVIEW_WINDOW_SIZE = { width: 480, height: 720 };
const REVIEW_WINDOW_MIN_HEIGHT = 480;

interface ReviewWindowEntry {
  window: BrowserWindow;
  clientIds: string[];
  selectedClientId: string | null;
  isReady: boolean;
  ready: Promise<void>;
}

export interface ScreenshotReviewTarget {
  shop: LocalScreenshot["shop"];
  objectId: string;
  clientIds: string[];
  selectedClientId: string;
}

const entries = new Map<string, ReviewWindowEntry>();
const reviewWindows = new Set<BrowserWindow>();
const windowClosedListeners = new Set<() => void>();
let pendingBigPictureRequest: ScreenshotReviewRequest | null = null;

const getReviewKey = (shop: string, objectId: string) => `${shop}:${objectId}`;

const sendBigPictureRequest = (
  bigPicture: BrowserWindow,
  request: ScreenshotReviewRequest
) => {
  pendingBigPictureRequest = request;
  bigPicture.webContents.send("on-screenshot-review-requested", request);
};

const buildReviewHash = (clientIds: string[], selectedClientId: string) =>
  `screenshot-review?${new URLSearchParams({
    clientIds: clientIds.join(","),
    selected: selectedClientId,
  }).toString()}`;

const createReviewWindow = (clientIds: string[], selectedClientId: string) => {
  const bounds = getCascadedReviewWindowBounds(
    reviewWindows.size,
    REVIEW_WINDOW_SIZE,
    screen.getPrimaryDisplay().workArea
  );
  const window = new BrowserWindow({
    ...bounds,
    minWidth: bounds.width,
    minHeight: Math.min(bounds.height, REVIEW_WINDOW_MIN_HEIGHT),
    show: false,
    frame: false,
    resizable: true,
    maximizable: false,
    fullscreenable: false,
    backgroundColor: "#1c1c1c",
    title: "Hydra",
    icon,
    skipTaskbar: false,
    webPreferences: {
      preload: path.join(__dirname, "../preload/index.mjs"),
      sandbox: false,
    },
  });

  window.removeMenu();
  reviewWindows.add(window);
  window.once("closed", () => {
    reviewWindows.delete(window);
  });

  if ((!app.isPackaged || isStaging) && process.env.HYDRA_REVIEW_DEVTOOLS) {
    window.webContents.openDevTools({ mode: "detach" });
  }

  const ready = new Promise<void>((resolve) => {
    window.once("ready-to-show", () => resolve());
    window.once("closed", () => resolve());
  });

  void WindowManager.loadWindowURL(
    window,
    buildReviewHash(clientIds, selectedClientId)
  );

  return { window, ready };
};

const sendReviewItems = (entry: ReviewWindowEntry) => {
  if (!entry.isReady || entry.window.isDestroyed()) return;
  entry.window.webContents.send(
    "on-screenshot-review-items-changed",
    entry.clientIds,
    entry.selectedClientId
  );
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

const focusWindow = (window: BrowserWindow) => {
  if (window.isDestroyed()) return;
  if (window.isMinimized()) window.restore();
  window.show();
  window.focus();
};

const openReviewWindow = (key: string, target: ScreenshotReviewTarget) => {
  const { window, ready } = createReviewWindow(
    target.clientIds,
    target.selectedClientId
  );
  const entry: ReviewWindowEntry = {
    window,
    clientIds: target.clientIds,
    selectedClientId: target.selectedClientId,
    isReady: false,
    ready,
  };
  entries.set(key, entry);

  window.once("closed", () => {
    if (entries.get(key) === entry) entries.delete(key);
    void releaseUnreviewedScreenshots(entry.clientIds);
    for (const listener of windowClosedListeners) listener();
  });

  void ready.then(() => {
    entry.isReady = true;
    sendReviewItems(entry);
    focusWindow(window);
  });
};

const watchBigPictureHandoff = (
  bigPicture: BrowserWindow,
  clientIds: string[]
) => {
  let released = false;
  const release = () => {
    if (released) return;
    released = true;
    if (
      pendingBigPictureRequest?.clientIds.some((clientId) =>
        clientIds.includes(clientId)
      )
    ) {
      pendingBigPictureRequest = null;
    }
    void releaseUnreviewedScreenshots(clientIds);
  };

  bigPicture.once("closed", release);
  bigPicture.webContents.once("render-process-gone", release);
};

export class ScreenshotReviewWindows {
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

  public static async openForGame(target: ScreenshotReviewTarget) {
    if (!target.clientIds.length) return;

    await markAsReviewing(target.clientIds);

    const key = getReviewKey(target.shop, target.objectId);
    const existing = entries.get(key);
    if (!existing || existing.window.isDestroyed()) {
      openReviewWindow(key, target);
      return;
    }

    const removedIds = existing.clientIds.filter(
      (clientId) => !target.clientIds.includes(clientId)
    );
    existing.clientIds = target.clientIds;
    existing.selectedClientId = target.selectedClientId;
    await releaseUnreviewedScreenshots(removedIds);
    sendReviewItems(existing);
    focusWindow(existing.window);
  }

  public static isScreenshotUnderReview(clientId: string) {
    return [...entries.values()].some(
      ({ window, clientIds }) =>
        !window.isDestroyed() &&
        window.isVisible() &&
        clientIds.includes(clientId)
    );
  }

  public static onWindowClosed(listener: () => void) {
    windowClosedListeners.add(listener);
    return () => {
      windowClosedListeners.delete(listener);
    };
  }

  public static async requestBigPictureReview(
    request: ScreenshotReviewRequest
  ) {
    const bigPicture = WindowManager.bigPictureWindow;
    if (!bigPicture) return false;

    await markAsReviewing(request.clientIds);
    watchBigPictureHandoff(bigPicture, request.clientIds);
    sendBigPictureRequest(bigPicture, request);
    return true;
  }

  public static async takePendingBigPictureRequest() {
    const request = pendingBigPictureRequest;
    if (!request || !WindowManager.bigPictureWindow) {
      pendingBigPictureRequest = null;
      return null;
    }

    const records = await Promise.all(
      request.clientIds.map((clientId) => LocalScreenshotStore.get(clientId))
    );
    const clientIds = request.clientIds.filter(
      (_, index) => records[index]?.state === "reviewing"
    );
    if (pendingBigPictureRequest === request) pendingBigPictureRequest = null;

    return clientIds.length ? { ...request, clientIds } : null;
  }

  public static getReviewItemsForSender(sender: Electron.WebContents) {
    for (const entry of entries.values()) {
      if (!entry.window.isDestroyed() && entry.window.webContents === sender) {
        return [...entry.clientIds];
      }
    }
    return null;
  }

  public static isReviewWindowSender(sender: Electron.WebContents) {
    return [...reviewWindows].some(
      (window) => !window.isDestroyed() && window.webContents === sender
    );
  }

  public static broadcast(channel: string, ...args: unknown[]) {
    for (const window of reviewWindows) {
      if (!window.isDestroyed()) window.webContents.send(channel, ...args);
    }
  }

  public static closeSingleItemWindows(clientId: string) {
    for (const entry of entries.values()) {
      if (entry.clientIds.length !== 1 || entry.clientIds[0] !== clientId) {
        continue;
      }
      if (!entry.window.isDestroyed()) entry.window.close();
    }
  }

  public static removeScreenshotFromWindows(clientId: string) {
    for (const entry of entries.values()) {
      if (!entry.clientIds.includes(clientId)) continue;
      entry.clientIds = entry.clientIds.filter(
        (candidate) => candidate !== clientId
      );
      if (entry.selectedClientId === clientId) entry.selectedClientId = null;
      if (entry.clientIds.length) {
        sendReviewItems(entry);
      } else if (!entry.window.isDestroyed()) {
        entry.window.close();
      }
    }
  }
}
