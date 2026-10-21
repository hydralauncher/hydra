import { BrowserWindow, app, screen } from "electron";
import path from "node:path";
import icon from "@resources/icon.png?asset";
import { isStaging } from "@main/constants";
import type { LocalScreenshot, ScreenshotReviewRequest } from "@types";

import { logger } from "../logger";
import { NativeAddon } from "../native-addon";
import { WindowManager } from "../window-manager";
import { LocalScreenshotStore } from "./local-screenshot-store";
import { getCascadedReviewWindowBounds } from "./screenshot-review-window-bounds";

const REVIEW_WINDOW_SIZE = { width: 480, height: 720 };
const REVIEW_WINDOW_MIN_HEIGHT = 480;

interface ReviewWindowEntry {
  window: BrowserWindow;
  clientIds: string[];
  isReady: boolean;
  ready: Promise<void>;
}

interface ReviewSession {
  sessionId: string;
  gameKey: string;
  shop: LocalScreenshot["shop"];
  objectId: string;
  gameTitle: string;
  gameWindowHandle: string | null;
  windows: ReviewWindowEntry[];
  isGameRunning: boolean;
  handedToBigPicture: boolean;
}

const sessions = new Map<string, ReviewSession>();
const reviewWindows = new Set<BrowserWindow>();
const windowClosedListeners = new Set<() => void>();
const sessionQueues = new Map<string, Promise<unknown>>();
let pendingBigPictureRequest: ScreenshotReviewRequest | null = null;

const sendBigPictureRequest = (
  bigPicture: BrowserWindow,
  request: ScreenshotReviewRequest
) => {
  pendingBigPictureRequest = request;
  bigPicture.webContents.send("on-screenshot-review-requested", request);
};

const runInSessionQueue = <T>(gameKey: string, task: () => Promise<T>) => {
  const previous = sessionQueues.get(gameKey) ?? Promise.resolve();
  const result = previous.then(task, task);
  const tail = result.catch(() => undefined);
  sessionQueues.set(gameKey, tail);
  void tail.then(() => {
    if (sessionQueues.get(gameKey) === tail) sessionQueues.delete(gameKey);
  });
  return result;
};

const getWindowHandle = (window: BrowserWindow) => {
  const buffer = window.getNativeWindowHandle();
  if (buffer.byteLength >= 8) return buffer.readBigUInt64LE(0).toString();
  if (buffer.byteLength >= 4) return String(buffer.readUInt32LE(0));
  return null;
};

const buildReviewHash = (clientIds: string[]) =>
  `screenshot-review?${new URLSearchParams({ clientIds: clientIds.join(",") }).toString()}`;

const createReviewWindow = (clientIds: string[], cascadeIndex: number) => {
  const bounds = getCascadedReviewWindowBounds(
    cascadeIndex,
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

  void WindowManager.loadWindowURL(window, buildReviewHash(clientIds));

  return { window, ready };
};

const sendReviewItems = (entry: ReviewWindowEntry) => {
  if (!entry.isReady || entry.window.isDestroyed()) return;
  entry.window.webContents.send(
    "on-screenshot-review-items-changed",
    entry.clientIds
  );
};

const releaseUnreviewedScreenshots = async (clientIds: string[]) => {
  for (const clientId of clientIds) {
    await LocalScreenshotStore.update(clientId, (current) =>
      current.state === "reviewing" ? { state: "local" } : {}
    );
  }
};

const placeBelowGameWindow = (
  entry: ReviewWindowEntry,
  session: ReviewSession
) => {
  if (process.platform !== "win32" || !session.gameWindowHandle) return;
  if (!session.isGameRunning || WindowManager.bigPictureWindow) return;

  const { window } = entry;
  if (window.isDestroyed()) return;

  const reviewHandle = getWindowHandle(window);
  if (!reviewHandle) return;

  const gameWindowHandle = session.gameWindowHandle;
  NativeAddon.placeWindowBelow(reviewHandle, gameWindowHandle);
  window.showInactive();
  const placed = NativeAddon.placeWindowBelow(reviewHandle, gameWindowHandle);

  if (!placed) {
    logger.warn("Could not place the screenshot review window below the game");
    window.hide();
  }
};

const attachWindow = (session: ReviewSession, clientIds: string[]) => {
  const liveWindowCount = session.windows.filter(
    ({ window }) => !window.isDestroyed()
  ).length;
  const { window, ready } = createReviewWindow(clientIds, liveWindowCount);
  const entry: ReviewWindowEntry = {
    window,
    clientIds,
    isReady: false,
    ready,
  };
  session.windows.push(entry);

  window.once("closed", () => {
    session.windows = session.windows.filter(
      (candidate) => candidate !== entry
    );
    if (!session.handedToBigPicture) {
      void releaseUnreviewedScreenshots(entry.clientIds);
    }
    for (const listener of windowClosedListeners) listener();
    if (
      !session.windows.length &&
      !session.isGameRunning &&
      sessions.get(session.gameKey) === session
    ) {
      sessions.delete(session.gameKey);
    }
  });

  void ready.then(() => {
    entry.isReady = true;
    sendReviewItems(entry);
    placeBelowGameWindow(entry, session);
  });
  return entry;
};

const hasPendingItems = async (entry: ReviewWindowEntry) => {
  const records = await Promise.all(
    entry.clientIds.map((clientId) => LocalScreenshotStore.get(clientId))
  );
  return records.some((record) => record?.state === "reviewing");
};

const findOpenEntry = async (session: ReviewSession) => {
  const liveEntries = session.windows.filter(
    ({ window }) => !window.isDestroyed()
  );
  for (const entry of liveEntries.toReversed()) {
    if (await hasPendingItems(entry)) return entry;
  }
  return null;
};

const createSession = (
  details: Omit<ReviewSession, "windows" | "handedToBigPicture">
) => {
  const session: ReviewSession = {
    ...details,
    windows: [],
    handedToBigPicture: false,
  };
  sessions.set(session.gameKey, session);
  return session;
};

const showSessionWindows = async (session: ReviewSession) => {
  const entries = session.windows.filter(({ window }) => !window.isDestroyed());
  await Promise.all(entries.map(({ ready }) => ready));

  const liveEntries = entries.filter(({ window }) => !window.isDestroyed());
  for (const { window } of liveEntries) window.showInactive();
  const first = liveEntries[0]?.window;
  if (first && !first.isDestroyed()) first.focus();
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

const handOffToBigPicture = (session: ReviewSession) => {
  const bigPicture = WindowManager.bigPictureWindow;
  if (!bigPicture) return false;

  const clientIds = session.windows.flatMap(({ clientIds }) => clientIds);
  if (!clientIds.length) return true;

  session.handedToBigPicture = true;
  watchBigPictureHandoff(bigPicture, clientIds);
  for (const { window } of session.windows) {
    if (!window.isDestroyed()) window.destroy();
  }

  sendBigPictureRequest(bigPicture, {
    gameKey: session.gameKey,
    shop: session.shop,
    objectId: session.objectId,
    gameTitle: session.gameTitle,
    clientIds,
  });
  return true;
};

const presentClosedSession = async (session: ReviewSession) => {
  if (!session.windows.length || handOffToBigPicture(session)) {
    if (sessions.get(session.gameKey) === session) {
      sessions.delete(session.gameKey);
    }
    return;
  }

  await showSessionWindows(session);
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

  public static addCapture({
    screenshot,
    gameKey,
    gameWindowHandle,
    isGameRunning,
  }: {
    screenshot: LocalScreenshot;
    gameKey: string;
    gameWindowHandle: string | null;
    isGameRunning: () => boolean;
  }) {
    return runInSessionQueue(gameKey, async () => {
      await LocalScreenshotStore.update(screenshot.clientId, {
        state: "reviewing",
      });

      let session = sessions.get(gameKey);
      if (!session?.isGameRunning) {
        session = createSession({
          sessionId: screenshot.gameSessionId ?? gameKey,
          gameKey,
          shop: screenshot.shop,
          objectId: screenshot.objectId ?? "",
          gameTitle: screenshot.gameTitle,
          gameWindowHandle,
          isGameRunning: isGameRunning(),
        });
      }

      if (gameWindowHandle) session.gameWindowHandle = gameWindowHandle;

      const openEntry = await findOpenEntry(session);
      if (sessions.get(gameKey) !== session) sessions.set(gameKey, session);
      if (openEntry && !openEntry.window.isDestroyed()) {
        openEntry.clientIds = [...openEntry.clientIds, screenshot.clientId];
        sendReviewItems(openEntry);
      } else {
        attachWindow(session, [screenshot.clientId]);
      }

      if (!session.isGameRunning) await presentClosedSession(session);
    });
  }

  public static async openForScreenshot(screenshot: LocalScreenshot) {
    const existing = [...sessions.values()]
      .flatMap((session) => session.windows)
      .find(
        ({ window, clientIds }) =>
          !window.isDestroyed() && clientIds.includes(screenshot.clientId)
      );

    if (existing) {
      await existing.ready;
      if (existing.window.isDestroyed()) return;
      existing.window.show();
      existing.window.focus();
      return;
    }

    await LocalScreenshotStore.update(screenshot.clientId, (current) =>
      current.state === "local" ? { state: "reviewing" } : {}
    );

    const session = createSession({
      sessionId: `manual:${screenshot.clientId}`,
      gameKey: `manual:${screenshot.clientId}`,
      shop: screenshot.shop,
      objectId: screenshot.objectId ?? "",
      gameTitle: screenshot.gameTitle,
      gameWindowHandle: null,
      isGameRunning: false,
    });
    attachWindow(session, [screenshot.clientId]);
    await showSessionWindows(session);
  }

  public static onGameClosed(gameKey: string) {
    return runInSessionQueue(gameKey, async () => {
      const session = sessions.get(gameKey);
      if (!session) return;

      session.isGameRunning = false;
      await presentClosedSession(session);
    });
  }

  public static isScreenshotUnderReview(clientId: string) {
    return [...sessions.values()].some((session) =>
      session.windows.some(
        ({ window, clientIds }) =>
          !window.isDestroyed() &&
          window.isVisible() &&
          clientIds.includes(clientId)
      )
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

    await Promise.all(
      request.clientIds.map((clientId) =>
        LocalScreenshotStore.update(clientId, (current) =>
          current.state === "local" ? { state: "reviewing" } : {}
        )
      )
    );
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
    for (const session of sessions.values()) {
      const entry = session.windows.find(
        ({ window }) => !window.isDestroyed() && window.webContents === sender
      );
      if (entry) return [...entry.clientIds];
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
    for (const session of sessions.values()) {
      for (const entry of session.windows) {
        if (entry.clientIds.length !== 1 || entry.clientIds[0] !== clientId) {
          continue;
        }
        if (!entry.window.isDestroyed()) entry.window.close();
      }
    }
  }

  public static removeScreenshotFromWindows(clientId: string) {
    for (const session of sessions.values()) {
      for (const entry of session.windows) {
        if (!entry.clientIds.includes(clientId)) continue;
        entry.clientIds = entry.clientIds.filter(
          (candidate) => candidate !== clientId
        );
        if (entry.clientIds.length) {
          sendReviewItems(entry);
        } else if (!entry.window.isDestroyed()) {
          entry.window.close();
        }
      }
    }
  }
}
