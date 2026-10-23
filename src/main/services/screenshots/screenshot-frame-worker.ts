import { BrowserWindow } from "electron";
import capturePagePath from "@resources/linux-game-capture.html?asset";

import { logger } from "../logger";
import {
  buildGrabFrameExpression,
  createGrabbedFrame,
  parseGrabbedFrame,
  type GrabbedFrameInfo,
  type GrabbedScreenshotFrame,
  type ScreenshotFrameGrabOptions,
} from "./screenshot-frame-script";

const RECYCLE_AFTER_IDLE_MS = 10_000;
const MAX_FRAME_ATTEMPTS = 3;

interface WorkerWindow {
  window: BrowserWindow;
  ready: Promise<void>;
}

let worker: WorkerWindow | null = null;
let isPrepared = false;
let recycleTimer: ReturnType<typeof setTimeout> | null = null;
let queue: Promise<unknown> = Promise.resolve();

const clearRecycleTimer = () => {
  if (recycleTimer) clearTimeout(recycleTimer);
  recycleTimer = null;
};

const destroyWorker = () => {
  const current = worker;
  worker = null;
  if (current && !current.window.isDestroyed()) current.window.destroy();
};

const createWorker = (): WorkerWindow => {
  const window = new BrowserWindow({
    show: false,
    skipTaskbar: true,
    webPreferences: {
      backgroundThrottling: false,
      contextIsolation: true,
      sandbox: true,
    },
  });
  const created: WorkerWindow = {
    window,
    ready: window.loadFile(capturePagePath).then(() => undefined),
  };
  window.once("closed", () => {
    if (worker === created) worker = null;
  });
  created.ready.catch((error) => {
    logger.error("Failed to load the screenshot capture worker", error);
    if (worker === created) destroyWorker();
  });
  return created;
};

const getWorker = () => {
  if (!worker || worker.window.isDestroyed()) worker = createWorker();
  return worker;
};

const scheduleRecycle = () => {
  clearRecycleTimer();
  recycleTimer = setTimeout(() => {
    recycleTimer = null;
    destroyWorker();
    if (isPrepared) getWorker();
  }, RECYCLE_AFTER_IDLE_MS);
  recycleTimer.unref?.();
};

export class BlankScreenshotFrameError extends Error {
  constructor() {
    super("Screenshot capture returned only blank frames");
    this.name = "BlankScreenshotFrameError";
  }
}

const buildGrabExpression = (
  sourceId: string,
  options: ScreenshotFrameGrabOptions
) => `(async () => {
  const video = document.querySelector("video");
  if (!navigator.mediaDevices?.getUserMedia || !(video instanceof HTMLVideoElement)) {
    throw new Error("The screenshot capture page cannot open a stream");
  }
  const stream = await navigator.mediaDevices.getUserMedia({
    audio: false,
    video: {
      mandatory: {
        chromeMediaSource: "desktop",
        chromeMediaSourceId: ${JSON.stringify(sourceId)},
        maxWidth: 7680,
        maxHeight: 4320,
        maxFrameRate: 30
      }
    }
  });
  try {
    video.srcObject = stream;
    await video.play();
    return await ${buildGrabFrameExpression("video", options)};
  } finally {
    stream.getTracks().forEach((track) => track.stop());
    video.srcObject = null;
  }
})()`;

const grabFrame = async (
  current: WorkerWindow,
  sourceId: string,
  options: ScreenshotFrameGrabOptions,
  attempt = 1
): Promise<GrabbedFrameInfo> => {
  const frame = parseGrabbedFrame(
    await current.window.webContents.executeJavaScript(
      buildGrabExpression(sourceId, options)
    )
  );
  if (!frame.isBlank) return frame;

  logger.warn("Screenshot capture returned a blank frame", {
    sourceId,
    attempt,
  });
  if (attempt >= MAX_FRAME_ATTEMPTS) throw new BlankScreenshotFrameError();
  return grabFrame(current, sourceId, options, attempt + 1);
};

const runInWorker = (current: WorkerWindow, expression: string) => {
  if (current.window.isDestroyed()) {
    return Promise.reject(
      new Error("The screenshot capture worker was closed")
    );
  }
  return current.window.webContents.executeJavaScript(expression);
};

export class ScreenshotFrameWorker {
  public static prepare() {
    isPrepared = true;
    clearRecycleTimer();
    void getWorker().ready.catch(() => undefined);
  }

  public static release() {
    isPrepared = false;
    clearRecycleTimer();
    destroyWorker();
  }

  public static grab(
    sourceId: string,
    options: ScreenshotFrameGrabOptions
  ): Promise<GrabbedScreenshotFrame> {
    let resolveReleased = () => {};
    const released = new Promise<void>((resolve) => {
      resolveReleased = resolve;
    });
    let isReleased = false;
    const releaseWorker = () => {
      if (isReleased) return;
      isReleased = true;
      scheduleRecycle();
      resolveReleased();
    };

    const task = queue.then(async () => {
      clearRecycleTimer();
      const current = getWorker();
      try {
        await current.ready;
        const info = await grabFrame(current, sourceId, options);
        const frame = createGrabbedFrame(info, (expression) =>
          runInWorker(current, expression)
        );
        return {
          ...frame,
          encode: (quality: number) =>
            frame.encode(quality).finally(releaseWorker),
          discard: () => {
            frame.discard();
            releaseWorker();
          },
        };
      } catch (error) {
        releaseWorker();
        throw error;
      }
    });
    queue = task.then(
      () => released,
      () => undefined
    );
    return task;
  }
}
