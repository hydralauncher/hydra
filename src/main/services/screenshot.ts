import { desktopCapturer, nativeImage, screen } from "electron";
import fs from "node:fs";
import path from "node:path";
import { logger } from "./logger";
import { screenshotsPath } from "@main/constants";

const SCREENSHOT_QUALITY = 80;
const SCREENSHOT_EXTENSION = "jpeg";
const MAX_WIDTH = 1280;
const MAX_HEIGHT = 720;
const MAX_STORED_SCREENSHOTS = 50;

const sanitizePathSegment = (value: string) =>
  Array.from(value)
    .filter((character) => (character.codePointAt(0) ?? 0) > 31)
    .join("")
    .replaceAll(/[<>:"/\\|?*]/g, "_")
    .replace(/[. ]+$/, "")
    .slice(0, 120)
    .trim() || "unknown";

const resizeToFit = (image: Electron.NativeImage) => {
  const { width, height } = image.getSize();

  if (width <= MAX_WIDTH && height <= MAX_HEIGHT) return image;

  const scale = Math.min(MAX_WIDTH / width, MAX_HEIGHT / height);

  return image.resize({
    width: Math.round(width * scale),
    height: Math.round(height * scale),
  });
};

const getPrimaryScreenSource = async () => {
  const sources = await desktopCapturer.getSources({
    types: ["screen"],
    thumbnailSize: { width: 1920, height: 1080 },
  });

  if (!sources.length) return null;

  const primaryDisplayId = String(screen.getPrimaryDisplay().id);

  return (
    sources.find((source) => source.display_id === primaryDisplayId) ??
    sources[0]
  );
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

const resolveScreenshotPath = (
  gameTitle: string,
  achievementDisplayName: string
) =>
  path.join(
    screenshotsPath,
    sanitizePathSegment(gameTitle),
    `${sanitizePathSegment(achievementDisplayName)}.${SCREENSHOT_EXTENSION}`
  );

export class ScreenshotService {
  public static async captureGameScreenshot(
    gameTitle: string,
    achievementDisplayName: string
  ) {
    const source = await getPrimaryScreenSource();

    if (!source) {
      throw new Error("No desktop source available for screenshot");
    }

    const image = resizeToFit(source.thumbnail);
    const filePath = resolveScreenshotPath(gameTitle, achievementDisplayName);

    await fs.promises.mkdir(path.dirname(filePath), { recursive: true });
    await fs.promises.writeFile(filePath, image.toJPEG(SCREENSHOT_QUALITY));

    return filePath;
  }

  public static async importGameScreenshot(
    sourcePath: string,
    gameTitle: string,
    achievementDisplayName: string
  ) {
    const image = resizeToFit(nativeImage.createFromPath(sourcePath));

    if (image.isEmpty()) {
      throw new Error(`Could not read emulator screenshot at ${sourcePath}`);
    }

    const filePath = resolveScreenshotPath(gameTitle, achievementDisplayName);

    await fs.promises.mkdir(path.dirname(filePath), { recursive: true });
    await fs.promises.writeFile(filePath, image.toJPEG(SCREENSHOT_QUALITY));

    return filePath;
  }

  public static async deleteGameScreenshot(
    gameTitle: string,
    achievementDisplayName: string
  ) {
    const filePath = resolveScreenshotPath(gameTitle, achievementDisplayName);

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
