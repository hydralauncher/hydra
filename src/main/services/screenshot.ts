import { desktopCapturer, nativeImage } from "electron";
import { execFile } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { promisify } from "node:util";
import { logger } from "./logger";
import { screenshotsPath } from "@main/constants";
import { resolveAchievementScreenshotPath } from "./achievement-screenshot-path";
import { fitScreenshotTo1080p } from "./screenshot-size";

const SCREENSHOT_QUALITY = 80;
const SCREENSHOT_EXTENSION = "jpeg";
const CAPTURE_THUMBNAIL_SIZE = { width: 3840, height: 2160 };
const MAX_STORED_SCREENSHOTS = 50;
const execFileAsync = promisify(execFile);

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
}

const getForegroundWindow = async (): Promise<ForegroundWindow | null> => {
  try {
    if (process.platform === "win32") {
      const script = [
        'Add-Type -TypeDefinition \'using System; using System.Runtime.InteropServices; public static class HydraForegroundWindow { [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow(); [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint processId); }\'',
        "$handle = [HydraForegroundWindow]::GetForegroundWindow()",
        "$processId = 0",
        "[void][HydraForegroundWindow]::GetWindowThreadProcessId($handle, [ref]$processId)",
        "$process = Get-Process -Id $processId -ErrorAction Stop",
        "Write-Output $processId",
        "Write-Output $process.MainWindowTitle",
      ].join("; ");
      const { stdout } = await execFileAsync("powershell.exe", [
        "-NoProfile",
        "-NonInteractive",
        "-Command",
        script,
      ]);
      const [processId, ...titleParts] = stdout.trim().split(/\r?\n/);

      return {
        processId: Number(processId),
        title: titleParts.join(" ").trim(),
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

const getGameWindowSource = async (expectedProcessId: number) => {
  const foregroundWindow = await getForegroundWindow();

  if (
    !foregroundWindow ||
    !Number.isFinite(foregroundWindow.processId) ||
    foregroundWindow.processId !== expectedProcessId
  ) {
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

const listStoredScreenshots = async (directory: string) => {
  const entries = await fs.promises.readdir(directory, {
    withFileTypes: true,
  });

  const files = await Promise.all(
    entries.map(async (entry) => {
      const entryPath = path.join(directory, entry.name);

      if (entry.isDirectory()) return listStoredScreenshots(entryPath);

      if (!entry.name.endsWith(`.${SCREENSHOT_EXTENSION}`)) return [];

      const stat = await fs.promises.stat(entryPath);
      return [{ path: entryPath, modifiedAt: stat.mtimeMs }];
    })
  );

  return files.flat();
};

export class ScreenshotService {
  public static async captureGameScreenshot(
    gameTitle: string,
    achievementDisplayName: string,
    gameId: string,
    achievementId: string,
    expectedProcessId: number
  ) {
    const source = await getGameWindowSource(expectedProcessId);

    const image = resizeToFit(source.thumbnail);
    const filePath = resolveAchievementScreenshotPath(
      screenshotsPath,
      gameTitle,
      achievementDisplayName,
      gameId,
      achievementId
    );

    await fs.promises.mkdir(path.dirname(filePath), { recursive: true });
    await fs.promises.writeFile(filePath, image.toJPEG(SCREENSHOT_QUALITY));

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

    const filePath = resolveAchievementScreenshotPath(
      screenshotsPath,
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
    const filePath = resolveAchievementScreenshotPath(
      screenshotsPath,
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
      if (!fs.existsSync(screenshotsPath)) return;

      const screenshots = await listStoredScreenshots(screenshotsPath);

      const outdated = screenshots
        .toSorted((a, b) => b.modifiedAt - a.modifiedAt)
        .slice(MAX_STORED_SCREENSHOTS);

      await Promise.all(
        outdated.map((screenshot) =>
          fs.promises.rm(screenshot.path, { force: true })
        )
      );

      const gameDirectories = await fs.promises.readdir(screenshotsPath, {
        withFileTypes: true,
      });

      await Promise.all(
        gameDirectories
          .filter((entry) => entry.isDirectory())
          .map(async (entry) => {
            const directory = path.join(screenshotsPath, entry.name);
            const remaining = await fs.promises.readdir(directory);

            if (!remaining.length) {
              await fs.promises.rmdir(directory);
            }
          })
      );
    } catch (error) {
      logger.error("Failed to cleanup old screenshots", error);
    }
  }
}
