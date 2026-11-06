import { BrowserWindow } from "electron";
import capturePagePath from "@resources/linux-game-capture.html?asset";

import { logger } from "../logger";
import {
  BlankScreenshotFrameError,
  buildGrabFrameExpression,
  createGrabbedFrame,
  parseGrabbedFrame,
  SCREENSHOT_CAPTURE_CALL_TIMEOUT_MS,
  type GrabbedFrameInfo,
  type GrabbedScreenshotFrame,
  type ScreenshotFrameGrabOptions,
} from "./screenshot-frame-script";
import {
  executeWithinDeadline,
  settleWithinDeadline,
  whileWindowAlive,
} from "./window-bound-promise";

const SHOULD_HOLD_STREAM = process.platform === "win32";
const RECYCLE_AFTER_IDLE_MS = SHOULD_HOLD_STREAM ? 5 * 60_000 : 10_000;
const MAX_FRAME_ATTEMPTS = 3;
const STALE_FRAME_SIZE_TOLERANCE_PX = 16;
const RESIZED_FRAME_TIMEOUT_MS = 300;
const RESIZED_FRAME_POLL_MS = 50;
const WORKER_CLOSED_MESSAGE = "The screenshot capture worker was closed";

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
    ready: whileWindowAlive(window, WORKER_CLOSED_MESSAGE, () =>
      window.loadFile(capturePagePath)
    ),
  };
  window.once("closed", () => {
    if (worker === created) worker = null;
  });
  created.ready.catch((error) => {
    if (window.isDestroyed()) return;
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

const buildOpenStreamExpression = (sourceId: string) =>
  `navigator.mediaDevices.getUserMedia({
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
  })`;

const GET_CAPTURE_VIDEO = `const video = document.querySelector("video");
  if (!navigator.mediaDevices?.getUserMedia || !(video instanceof HTMLVideoElement)) {
    throw new Error("The screenshot capture page cannot open a stream");
  }`;

const buildSingleUseStreamGrabExpression = (
  sourceId: string,
  options: ScreenshotFrameGrabOptions
) => `(async () => {
  ${GET_CAPTURE_VIDEO}
  const stream = await ${buildOpenStreamExpression(sourceId)};
  try {
    video.srcObject = stream;
    await video.play();
    return await ${buildGrabFrameExpression("video", options)};
  } finally {
    stream.getTracks().forEach((track) => track.stop());
    video.srcObject = null;
  }
})()`;

const WAIT_FOR_RESIZED_FRAME_FUNCTION = `async (video, sizeScale, { expectedSize, tolerance, timeout, pollInterval }) => {
  if (!expectedSize) return true;
  const hasOutdatedSize = () =>
    Math.abs(video.videoWidth - expectedSize.width * (sizeScale?.x ?? 1)) > tolerance ||
    Math.abs(video.videoHeight - expectedSize.height * (sizeScale?.y ?? 1)) > tolerance;
  if (!hasOutdatedSize()) return true;
  const nextFrame = () => new Promise((resolve) => {
    const timer = setTimeout(resolve, pollInterval);
    video.requestVideoFrameCallback(() => { clearTimeout(timer); resolve(); });
  });
  const deadline = performance.now() + timeout;
  while (hasOutdatedSize() && performance.now() < deadline) await nextFrame();
  if (hasOutdatedSize()) return false;
  await nextFrame();
  return true;
}`;

const CLOSE_HELD_STREAM_FUNCTION = `(video) => {
  globalThis.__hydraHeldCapture?.stream.getTracks().forEach((track) => track.stop());
  globalThis.__hydraHeldCapture = null;
  video.srcObject = null;
}`;

const CLOSE_HELD_STREAM_EXPRESSION = `(${CLOSE_HELD_STREAM_FUNCTION})(document.querySelector("video"))`;

const buildHeldStreamGrabExpression = (
  sourceId: string,
  options: ScreenshotFrameGrabOptions
) => `(async () => {
  ${GET_CAPTURE_VIDEO}
  const sourceId = ${JSON.stringify(sourceId)};
  const expectedSize = ${JSON.stringify(options.expectedSize ?? null)};
  const closeHeldStream = () => (${CLOSE_HELD_STREAM_FUNCTION})(video);
  const held = globalThis.__hydraHeldCapture;
  const isHeldStreamLive =
    held?.sourceId === sourceId &&
    held.stream.getVideoTracks().some((track) => track.readyState === "live");
  try {
    const canReuseStream =
      isHeldStreamLive &&
      (await (${WAIT_FOR_RESIZED_FRAME_FUNCTION})(video, held.sizeScale, ${JSON.stringify(
        {
          expectedSize: options.expectedSize ?? null,
          tolerance: STALE_FRAME_SIZE_TOLERANCE_PX,
          timeout: RESIZED_FRAME_TIMEOUT_MS,
          pollInterval: RESIZED_FRAME_POLL_MS,
        }
      )}));
    if (!canReuseStream) {
      closeHeldStream();
      const stream = await ${buildOpenStreamExpression(sourceId)};
      globalThis.__hydraHeldCapture = { sourceId, stream, sizeScale: null };
      video.srcObject = stream;
      await video.play();
    }
    const frame = await ${buildGrabFrameExpression("video", options)};
    if (!canReuseStream && expectedSize) {
      globalThis.__hydraHeldCapture.sizeScale = {
        x: video.videoWidth / expectedSize.width,
        y: video.videoHeight / expectedSize.height,
      };
    }
    return frame;
  } catch (error) {
    closeHeldStream();
    throw error;
  }
})()`;

const buildGrabExpression = SHOULD_HOLD_STREAM
  ? buildHeldStreamGrabExpression
  : buildSingleUseStreamGrabExpression;

const recycleTimedOutWorker = (current: WorkerWindow, stage: string) => () => {
  logger.warn("Screenshot capture worker timed out, recycling it", {
    stage,
    timeoutMs: SCREENSHOT_CAPTURE_CALL_TIMEOUT_MS,
  });
  if (worker === current) destroyWorker();
};

const runInWorker = (current: WorkerWindow, expression: string) =>
  executeWithinDeadline(
    current.window,
    WORKER_CLOSED_MESSAGE,
    expression,
    SCREENSHOT_CAPTURE_CALL_TIMEOUT_MS,
    recycleTimedOutWorker(current, "call")
  );

const waitForWorkerPage = (current: WorkerWindow) =>
  settleWithinDeadline(
    current.ready,
    SCREENSHOT_CAPTURE_CALL_TIMEOUT_MS,
    recycleTimedOutWorker(current, "page_load")
  );

const grabFrame = async (
  current: WorkerWindow,
  sourceId: string,
  options: ScreenshotFrameGrabOptions,
  attempt = 1
): Promise<GrabbedFrameInfo> => {
  const frame = parseGrabbedFrame(
    await runInWorker(current, buildGrabExpression(sourceId, options))
  );
  if (!frame.isBlank) return frame;

  logger.warn("Screenshot capture returned a blank frame", {
    sourceId,
    attempt,
  });
  if (attempt >= MAX_FRAME_ATTEMPTS) throw new BlankScreenshotFrameError();
  if (SHOULD_HOLD_STREAM && attempt === MAX_FRAME_ATTEMPTS - 1) {
    await runInWorker(current, CLOSE_HELD_STREAM_EXPRESSION);
  }
  return grabFrame(
    current,
    sourceId,
    SHOULD_HOLD_STREAM ? { ...options, waitForNextFrame: true } : options,
    attempt + 1
  );
};

export class ScreenshotFrameWorker {
  public static prepare() {
    isPrepared = true;
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
        await waitForWorkerPage(current);
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
