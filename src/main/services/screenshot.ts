import { desktopCapturer, nativeImage } from "electron";
import { execFile } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { promisify } from "node:util";
import { logger } from "./logger";
import { resolveAchievementScreenshotPath } from "./achievement-screenshot-path";
import { getAchievementScreenshotsDirectory } from "./achievement-screenshots-directory";
import { fitScreenshotTo1080p } from "./screenshot-size";
import { NativeAddon } from "./native-addon";
import { isLinuxGameWindowProcess } from "./linux-process-match";
import {
  captureLinuxGameSessionFrame,
  isWaylandCaptureBackend,
} from "./linux-game-capture-session";
import {
  getWindowsProcessAncestryDiagnostics,
  isWindowsGameForegroundProcess,
  isWindowsWindowSource,
} from "./windows-game-window-match";
import { captureWindowsGameWindowFrame } from "./windows-game-capture";
import { cropToWindowClientArea } from "./windows-window-bounds";
import {
  getBitmapColorRange,
  isMostlyBlackScreenshot,
  isNearlyUniformScreenshot,
} from "./screenshot-frame-validation";
import {
  LocalSouvenirAssetStore,
  PendingGroupedSouvenirStore,
} from "./achievements/grouped-souvenir-store";

const SCREENSHOT_QUALITY = 80;
const CAPTURE_THUMBNAIL_SIZE = { width: 3840, height: 2160 };
const MAX_STORED_SCREENSHOTS = 50;
const WINDOWS_SOURCE_RESOLUTION_ATTEMPTS = 3;
const WINDOWS_SOURCE_RETRY_DELAY_MS = 100;
const X11_CAPTURE_ATTEMPTS = 3;
const X11_CAPTURE_RETRY_DELAY_MS = 100;
const execFileAsync = promisify(execFile);

export class BlankScreenshotError extends Error {
  constructor(sourcePath: string) {
    super(`Emulator screenshot is blank: ${sourcePath}`);
    this.name = "BlankScreenshotError";
  }
}

const wait = (delay: number) =>
  new Promise((resolve) => {
    setTimeout(resolve, delay);
  });

const isBlankImage = (image: Electron.NativeImage) => {
  const sample = image.resize({ width: 32, height: 32, quality: "good" });
  const pixels = sample.toBitmap();

  return (
    isNearlyUniformScreenshot(getBitmapColorRange(pixels)) ||
    isMostlyBlackScreenshot(pixels)
  );
};

const resizeToFit = (image: Electron.NativeImage) => {
  const currentSize = image.getSize();
  const outputSize = fitScreenshotTo1080p(currentSize);

  if (
    currentSize.width === outputSize.width &&
    currentSize.height === outputSize.height
  ) {
    return image;
  }

  return image.resize(outputSize);
};

interface ForegroundWindow {
  processId: number;
  title: string;
  windowHandle?: string;
}

export interface GameScreenshotCaptureTarget {
  processId?: number;
  executablePaths?: string[];
  winePrefixPath?: string | null;
  gameKey?: string;
  windowHandle?: string;
  x11WindowId?: string;
  cropToClientArea?: boolean;
}

export interface GameScreenshotOutput {
  filePath: string;
  quality: number;
  fitTo1080p: boolean;
}

export const getForegroundWindow =
  async (): Promise<ForegroundWindow | null> => {
    try {
      if (process.platform === "win32") {
        const script = [
          'Add-Type -TypeDefinition \'using System; using System.Runtime.InteropServices; public static class HydraForegroundWindow { [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow(); [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint processId); }\'',
          "$handle = [HydraForegroundWindow]::GetForegroundWindow()",
          "$processId = 0",
          "[void][HydraForegroundWindow]::GetWindowThreadProcessId($handle, [ref]$processId)",
          "$process = Get-Process -Id $processId -ErrorAction Stop",
          "Write-Output $handle.ToInt64()",
          "Write-Output $processId",
          "Write-Output $process.MainWindowTitle",
        ].join("; ");
        const { stdout } = await execFileAsync("powershell.exe", [
          "-NoProfile",
          "-NonInteractive",
          "-Command",
          script,
        ]);
        const [windowHandle, processId, ...titleParts] = stdout
          .trim()
          .split(/\r?\n/);

        return {
          processId: Number(processId),
          title: titleParts.join(" ").trim(),
          windowHandle,
        };
      }

      if (process.platform === "darwin") {
        const { stdout } = await execFileAsync("osascript", [
          "-e",
          'tell application "System Events" to tell first application process whose frontmost is true to return (unix id as text) & linefeed & (name of front window as text)',
        ]);
        const [processId, ...titleParts] = stdout.trim().split(/\r?\n/);

        return {
          processId: Number(processId),
          title: titleParts.join(" ").trim(),
        };
      }
    } catch (error) {
      logger.error("Failed to identify the foreground game window", error);
    }

    return null;
  };

const resolveX11GameWindowId = async (
  captureTarget: GameScreenshotCaptureTarget
) => {
  if (captureTarget.x11WindowId) return captureTarget.x11WindowId;

  const activeWindow = NativeAddon.getLinuxActiveWindow();

  if (!activeWindow?.processId) {
    throw new Error("Could not identify the active X11 window process");
  }

  const processes = await NativeAddon.listProcesses();
  const belongsToGame = isLinuxGameWindowProcess(
    processes,
    activeWindow.processId,
    captureTarget.processId,
    captureTarget.executablePaths ?? [],
    captureTarget.winePrefixPath
  );

  if (!belongsToGame) {
    throw new Error("Tracked game does not own the active X11 window");
  }

  return activeWindow.windowId;
};

const captureX11WindowThumbnail = async (windowId: string) => {
  const sources = await desktopCapturer.getSources({
    types: ["window"],
    thumbnailSize: CAPTURE_THUMBNAIL_SIZE,
  });
  const source = sources.find((candidate) => {
    const match = /^window:(\d+):/.exec(candidate.id);
    return match?.[1] === windowId;
  });

  if (!source) throw new Error("Could not capture the active X11 game window");

  return source.thumbnail;
};

const captureNonBlankX11Frame = async (
  windowId: string,
  attempt = 1
): Promise<Electron.NativeImage> => {
  const image = await captureX11WindowThumbnail(windowId);
  if (!image.isEmpty() && !isBlankImage(image)) return image;

  logger.warn("X11 game-window capture returned a blank frame", {
    windowId,
    attempt,
  });
  if (attempt >= X11_CAPTURE_ATTEMPTS) {
    throw new Error("X11 game-window capture returned only blank frames");
  }

  await wait(X11_CAPTURE_RETRY_DELAY_MS);
  return captureNonBlankX11Frame(windowId, attempt + 1);
};

const captureX11GameWindowFrame = async (
  captureTarget: GameScreenshotCaptureTarget
) => captureNonBlankX11Frame(await resolveX11GameWindowId(captureTarget));

const findWindowsWindowSource = async (windowHandle: string) => {
  const sources = await desktopCapturer.getSources({
    types: ["window"],
    thumbnailSize: { width: 0, height: 0 },
  });

  return {
    source:
      sources.find((candidate) =>
        isWindowsWindowSource(candidate.id, windowHandle)
      ) ?? null,
    sourceCount: sources.length,
  };
};

const resolveWindowsGameWindowSource = async (
  captureTarget: GameScreenshotCaptureTarget
) => {
  const foregroundWindow = await getForegroundWindow();

  if (
    !foregroundWindow ||
    !Number.isFinite(foregroundWindow.processId) ||
    !foregroundWindow.windowHandle
  ) {
    throw new Error("Could not identify the foreground game window");
  }

  const windowHandle = foregroundWindow.windowHandle;
  const processes = await NativeAddon.listProcesses();
  const belongsToGame = isWindowsGameForegroundProcess(
    processes,
    foregroundWindow.processId,
    captureTarget.processId,
    captureTarget.executablePaths ?? []
  );

  if (!belongsToGame) {
    logger.warn("Windows game capture rejected the foreground process", {
      executablePaths: captureTarget.executablePaths ?? [],
      foregroundProcessId: foregroundWindow.processId,
      launchedProcessId: captureTarget.processId,
      processAncestry: getWindowsProcessAncestryDiagnostics(
        processes,
        foregroundWindow.processId
      ),
      windowHandle,
    });
    throw new Error("Tracked game does not own the foreground window");
  }

  const { source, sourceCount } = await findWindowsWindowSource(windowHandle);

  if (!source) {
    logger.warn(
      "Windows game capture could not resolve the foreground source",
      {
        foregroundProcessId: foregroundWindow.processId,
        windowHandle,
        sourceCount,
      }
    );
    throw new Error("Could not identify the foreground game window");
  }

  logger.info("Windows game capture source resolved", {
    foregroundProcessId: foregroundWindow.processId,
    windowHandle,
    sourceId: source.id,
  });

  return source;
};

const resolveWindowsGameWindowSourceWithRetry = async (
  captureTarget: GameScreenshotCaptureTarget,
  attempt = 1
): Promise<Electron.DesktopCapturerSource> => {
  try {
    return await resolveWindowsGameWindowSource(captureTarget);
  } catch (error) {
    if (attempt >= WINDOWS_SOURCE_RESOLUTION_ATTEMPTS) throw error;

    await wait(WINDOWS_SOURCE_RETRY_DELAY_MS);
    return resolveWindowsGameWindowSourceWithRetry(captureTarget, attempt + 1);
  }
};

const getWindowsGameWindowSource = async (
  captureTarget: GameScreenshotCaptureTarget
) => {
  if (captureTarget.windowHandle) {
    const { source } = await findWindowsWindowSource(
      captureTarget.windowHandle
    );
    if (source) return source;
  }

  return resolveWindowsGameWindowSourceWithRetry(captureTarget);
};

const getGameWindowSource = async (
  captureTarget: GameScreenshotCaptureTarget
) => {
  if (process.platform === "win32") {
    return getWindowsGameWindowSource(captureTarget);
  }

  const foregroundWindow = await getForegroundWindow();

  if (!foregroundWindow || !Number.isFinite(foregroundWindow.processId)) {
    throw new Error("Tracked game does not own the foreground window");
  }

  const expectedProcessId = captureTarget.processId;
  const belongsToGame =
    expectedProcessId !== undefined &&
    foregroundWindow.processId === expectedProcessId;

  if (!belongsToGame) {
    throw new Error("Tracked game does not own the foreground window");
  }

  const sources = await desktopCapturer.getSources({
    types: ["window"],
    thumbnailSize: CAPTURE_THUMBNAIL_SIZE,
  });

  const foregroundTitle = foregroundWindow.title.trim().toLowerCase();

  if (!foregroundTitle) {
    throw new Error("Could not identify the foreground game window title");
  }

  const source = sources.find((candidate) => {
    const sourceTitle = candidate.name.trim().toLowerCase();
    return sourceTitle === foregroundTitle;
  });

  if (!source) throw new Error("Could not identify the foreground game window");

  return source;
};

const findX11WindowSourceId = async (windowId: string) => {
  const sources = await desktopCapturer.getSources({
    types: ["window"],
    thumbnailSize: { width: 0, height: 0 },
  });
  const source = sources.find(
    (candidate) => /^window:(\d+):/.exec(candidate.id)?.[1] === windowId
  );
  if (!source) throw new Error("Could not find the active X11 game window");
  return source.id;
};

export const resolveGameCaptureSourceId = async (
  captureTarget: GameScreenshotCaptureTarget
) => {
  if (process.platform === "win32") {
    return (await getWindowsGameWindowSource(captureTarget)).id;
  }
  if (process.platform === "linux" && !isWaylandCaptureBackend()) {
    return findX11WindowSourceId(await resolveX11GameWindowId(captureTarget));
  }
  return null;
};

const captureGameImage = async (
  captureTarget: GameScreenshotCaptureTarget
): Promise<Electron.NativeImage> => {
  if (isWaylandCaptureBackend()) {
    if (!captureTarget.gameKey) {
      throw new Error("No game session available for Wayland capture");
    }

    return captureLinuxGameSessionFrame(captureTarget.gameKey);
  }

  if (process.platform === "win32") {
    const source = await getGameWindowSource(captureTarget);
    const image = await captureWindowsGameWindowFrame(source.id);
    return captureTarget.cropToClientArea
      ? cropToWindowClientArea(image, source.id)
      : image;
  }

  if (process.platform === "linux") {
    return captureX11GameWindowFrame(captureTarget);
  }

  return (await getGameWindowSource(captureTarget)).thumbnail;
};

export class ScreenshotService {
  public static getScreenshotsPath() {
    return getAchievementScreenshotsDirectory();
  }

  public static captureRawGameImage(
    captureTarget: GameScreenshotCaptureTarget
  ) {
    return captureGameImage(captureTarget);
  }

  public static async captureGameImage(
    captureTarget: GameScreenshotCaptureTarget,
    output: GameScreenshotOutput
  ) {
    const capturedImage = await captureGameImage(captureTarget);
    const image = output.fitTo1080p
      ? resizeToFit(capturedImage)
      : capturedImage;

    await fs.promises.mkdir(path.dirname(output.filePath), {
      recursive: true,
    });
    await fs.promises.writeFile(output.filePath, image.toJPEG(output.quality));

    return { filePath: output.filePath, image };
  }

  public static async captureGameScreenshot(
    gameTitle: string,
    achievementDisplayName: string,
    gameId: string,
    achievementId: string,
    captureTarget: GameScreenshotCaptureTarget
  ) {
    const screenshotsDirectory = await this.getScreenshotsPath();
    const filePath = resolveAchievementScreenshotPath(
      screenshotsDirectory,
      gameTitle,
      achievementDisplayName,
      gameId,
      achievementId
    );

    await this.captureGameImage(captureTarget, {
      filePath,
      quality: SCREENSHOT_QUALITY,
      fitTo1080p: true,
    });

    return filePath;
  }

  public static async importGameScreenshot(
    sourcePath: string,
    gameTitle: string,
    achievementDisplayName: string,
    gameId: string,
    achievementId: string
  ) {
    const image = resizeToFit(nativeImage.createFromPath(sourcePath));

    if (image.isEmpty()) {
      throw new Error(`Could not read emulator screenshot at ${sourcePath}`);
    }
    if (isBlankImage(image)) {
      throw new BlankScreenshotError(sourcePath);
    }

    const screenshotsDirectory = await this.getScreenshotsPath();
    const filePath = resolveAchievementScreenshotPath(
      screenshotsDirectory,
      gameTitle,
      achievementDisplayName,
      gameId,
      achievementId
    );

    await fs.promises.mkdir(path.dirname(filePath), { recursive: true });
    await fs.promises.writeFile(filePath, image.toJPEG(SCREENSHOT_QUALITY));

    return filePath;
  }

  public static async deleteGameScreenshot(
    gameTitle: string,
    achievementDisplayName: string,
    gameId: string,
    achievementId: string
  ) {
    const screenshotsDirectory = await this.getScreenshotsPath();
    const filePath = resolveAchievementScreenshotPath(
      screenshotsDirectory,
      gameTitle,
      achievementDisplayName,
      gameId,
      achievementId
    );

    await fs.promises.rm(filePath, { force: true });

    const directory = path.dirname(filePath);
    const remaining = await fs.promises
      .readdir(directory)
      .catch(() => ["keep"]);

    if (!remaining.length) await fs.promises.rmdir(directory);
  }

  public static async deleteScreenshot(filePath: string) {
    await fs.promises.rm(filePath, { force: true });
  }

  public static async cleanupOldScreenshots() {
    try {
      const protectedPaths =
        await PendingGroupedSouvenirStore.getProtectedScreenshotPaths();
      const assets = await LocalSouvenirAssetStore.list();
      const screenshots = (
        await Promise.all(
          assets.map(async (asset) => {
            const stat = await fs.promises
              .stat(asset.screenshotPath)
              .catch(() => null);

            if (!stat) return null;
            return {
              path: asset.screenshotPath,
              modifiedAt: stat.mtimeMs,
            };
          })
        )
      ).filter((screenshot) => screenshot !== null);

      const outdated = screenshots
        .filter((screenshot) => !protectedPaths.has(screenshot.path))
        .toSorted((a, b) => b.modifiedAt - a.modifiedAt)
        .slice(MAX_STORED_SCREENSHOTS);

      const cleanupResults = await Promise.allSettled(
        outdated.map((screenshot) =>
          fs.promises.rm(screenshot.path, { force: true })
        )
      );
      const removedPaths = new Set(
        outdated
          .filter((_, index) => cleanupResults[index]?.status === "fulfilled")
          .map((screenshot) => screenshot.path)
      );
      await LocalSouvenirAssetStore.deleteByScreenshotPaths(removedPaths);

      for (const result of cleanupResults) {
        if (result.status === "rejected") {
          logger.error("Failed to delete an old screenshot", result.reason);
        }
      }

      const affectedDirectories = new Set(
        Array.from(removedPaths, (screenshotPath) =>
          path.dirname(screenshotPath)
        )
      );

      await Promise.all(
        Array.from(affectedDirectories, async (directory) => {
          const remaining = await fs.promises
            .readdir(directory)
            .catch(() => []);
          if (!remaining.length) await fs.promises.rmdir(directory);
        })
      );
    } catch (error) {
      logger.error("Failed to cleanup old screenshots", error);
    }
  }
}
