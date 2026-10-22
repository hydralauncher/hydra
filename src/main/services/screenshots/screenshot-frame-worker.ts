import { BrowserWindow } from "electron";
import capturePagePath from "@resources/linux-game-capture.html?asset";

import { logger } from "../logger";
import {
  buildEncodeFrameExpression,
  parseEncodedFrame,
  type EncodedScreenshotFrame,
  type ScreenshotFrameEncodeOptions,
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

const buildCaptureExpression = (
  sourceId: string,
  options: ScreenshotFrameEncodeOptions
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
    return await ${buildEncodeFrameExpression("video", options)};
  } finally {
    stream.getTracks().forEach((track) => track.stop());
    video.srcObject = null;
  }
})()`;

const captureFrame = async (
  current: WorkerWindow,
  sourceId: string,
  options: ScreenshotFrameEncodeOptions,
  attempt = 1
): Promise<EncodedScreenshotFrame> => {
  const frame = parseEncodedFrame(
    await current.window.webContents.executeJavaScript(
      buildCaptureExpression(sourceId, options)
    )
  );
  if (!frame.isBlank) return frame;

  logger.warn("Screenshot capture returned a blank frame", {
    sourceId,
    attempt,
  });
  if (attempt >= MAX_FRAME_ATTEMPTS) {
    throw new Error("Screenshot capture returned only blank frames");
  }
  return captureFrame(current, sourceId, options, attempt + 1);
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

  public static capture(
    sourceId: string,
    options: ScreenshotFrameEncodeOptions
  ) {
    const task = queue.then(async () => {
      clearRecycleTimer();
      const current = getWorker();
      try {
        await current.ready;
        return await captureFrame(current, sourceId, options);
      } finally {
        scheduleRecycle();
      }
    });
    queue = task.catch(() => undefined);
    return task;
  }
}
