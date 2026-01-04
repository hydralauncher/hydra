import { desktopCapturer, nativeImage, app } from "electron";
import fs from "node:fs";
import path from "node:path";
import { logger } from "./logger";
import { screenshotsPath } from "@main/constants";

export class ScreenshotService {
  private static readonly SCREENSHOT_QUALITY = 80;
  private static readonly SCREENSHOT_FORMAT = "jpeg";
  private static readonly MAX_WIDTH = 1280;
  private static readonly MAX_HEIGHT = 720;

  private static compressImage(
    image: Electron.NativeImage
  ): Electron.NativeImage {
    const size = image.getSize();

    let newWidth = size.width;
    let newHeight = size.height;

    if (newWidth > this.MAX_WIDTH || newHeight > this.MAX_HEIGHT) {
      const aspectRatio = newWidth / newHeight;

      if (newWidth > newHeight) {
        newWidth = this.MAX_WIDTH;
        newHeight = Math.round(newWidth / aspectRatio);
      } else {
        newHeight = this.MAX_HEIGHT;
        newWidth = Math.round(newHeight * aspectRatio);
      }
    }

    if (newWidth !== size.width || newHeight !== size.height) {
      return image.resize({ width: newWidth, height: newHeight });
    }

    return image;
  }

  public static async captureDesktopScreenshot(
    gameTitle?: string,
    achievementName?: string
  ): Promise<string> {
    try {
      const sources = await desktopCapturer.getSources({
        types: ["screen"],
        thumbnailSize: { width: 1920, height: 1080 },
      });

      if (sources.length === 0) {
        throw new Error("No desktop sources available for screenshot");
      }

      console.log("sources", sources);

      const primaryScreen = sources[0];

      const originalImage = nativeImage.createFromDataURL(
        primaryScreen.thumbnail.toDataURL()
      );

      const compressedImage = this.compressImage(originalImage);

      let finalDir = screenshotsPath;
      let filename: string;

      if (gameTitle && achievementName) {
        const sanitizedGameTitle = gameTitle.replaceAll(/[<>:"/\\|?*]/g, "_");
        const gameDir = path.join(screenshotsPath, sanitizedGameTitle);
        finalDir = gameDir;

        const sanitizedAchievementName = achievementName.replaceAll(
          /[<>:"/\\|?*]/g,
          "_"
        );
        filename = `${sanitizedAchievementName}.${this.SCREENSHOT_FORMAT}`;
      } else {
        const timestamp = Date.now();
        filename = `achievement_screenshot_${timestamp}.${this.SCREENSHOT_FORMAT}`;
      }

      if (!fs.existsSync(finalDir)) {
        fs.mkdirSync(finalDir, { recursive: true });
      }

      const screenshotPath = path.join(finalDir, filename);

      const jpegBuffer = compressedImage.toJPEG(this.SCREENSHOT_QUALITY);
      fs.writeFileSync(screenshotPath, jpegBuffer);

      logger.log(`Compressed screenshot saved to: ${screenshotPath}`);
      return screenshotPath;
    } catch (error) {
      logger.error("Failed to capture desktop screenshot:", error);
      throw error;
    }
  }

  public static async cleanupOldScreenshots(): Promise<void> {
    try {
      const userDataPath = app.getPath("userData");
      const screenshotsDir = path.join(userDataPath, "screenshots");

      if (!fs.existsSync(screenshotsDir)) {
        return;
      }

      const getAllFiles = (
        dir: string
      ): Array<{ name: string; path: string; mtime: Date }> => {
        const files: Array<{ name: string; path: string; mtime: Date }> = [];

        const items = fs.readdirSync(dir);
        for (const item of items) {
          const itemPath = path.join(dir, item);
          const stat = fs.statSync(itemPath);

          if (stat.isDirectory()) {
            files.push(...getAllFiles(itemPath));
          } else if (item.endsWith(`.${this.SCREENSHOT_FORMAT}`)) {
            files.push({
              name: item,
              path: itemPath,
              mtime: stat.mtime,
            });
          }
        }

        return files;
      };

      const allFiles = getAllFiles(screenshotsDir).sort(
        (a, b) => b.mtime.getTime() - a.mtime.getTime()
      );

      const filesToDelete = allFiles.slice(50);

      for (const file of filesToDelete) {
        try {
          fs.unlinkSync(file.path);
          logger.log(`Cleaned up old screenshot: ${file.name}`);
        } catch (error) {
          logger.error(`Failed to delete screenshot ${file.name}:`, error);
        }
      }

      const cleanupEmptyDirs = (dir: string) => {
        if (dir === screenshotsDir) return;

        try {
          const items = fs.readdirSync(dir);
          if (items.length === 0) {
            fs.rmdirSync(dir);
            logger.log(`Cleaned up empty directory: ${dir}`);
          }
        } catch (error) {
          logger.error(`Failed to read directory ${dir}:`, error);
        }
      };

      const gameDirectories = fs
        .readdirSync(screenshotsDir)
        .map((item) => path.join(screenshotsDir, item))
        .filter((itemPath) => {
          try {
            return fs.statSync(itemPath).isDirectory();
          } catch {
            return false;
          }
        });

      for (const gameDir of gameDirectories) {
        cleanupEmptyDirs(gameDir);
      }
    } catch (error) {
      logger.error("Failed to cleanup old screenshots:", error);
    }
  }
}
