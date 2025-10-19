import { desktopCapturer, nativeImage } from "electron";
import fs from "node:fs";
import path from "node:path";
import { app } from "electron";
import { logger } from "./logger";

export class ScreenshotService {
  private static readonly SCREENSHOT_QUALITY = 60; // Reduced for better compression
  private static readonly SCREENSHOT_FORMAT = "jpeg";
  private static readonly MAX_WIDTH = 1280; // Maximum width for compression
  private static readonly MAX_HEIGHT = 720; // Maximum height for compression

  /**
   * Compresses an image by resizing and adjusting quality
   */
  private static compressImage(
    image: Electron.NativeImage
  ): Electron.NativeImage {
    const size = image.getSize();

    // Calculate new dimensions while maintaining aspect ratio
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

    // Resize the image if dimensions changed
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
      // Get all available desktop sources
      const sources = await desktopCapturer.getSources({
        types: ["screen"],
        thumbnailSize: { width: 1920, height: 1080 },
      });

      if (sources.length === 0) {
        throw new Error("No desktop sources available for screenshot");
      }

      // Use the primary screen (first source)
      const primaryScreen = sources[0];

      // Convert the thumbnail to a higher quality image
      const originalImage = nativeImage.createFromDataURL(
        primaryScreen.thumbnail.toDataURL()
      );

      // Compress the image to reduce file size
      const compressedImage = this.compressImage(originalImage);

      // Create screenshots directory structure
      const userDataPath = app.getPath("userData");
      const screenshotsDir = path.join(userDataPath, "screenshots");

      let finalDir = screenshotsDir;
      let filename: string;

      if (gameTitle && achievementName) {
        // Create game-specific directory
        const sanitizedGameTitle = gameTitle.replace(/[<>:"/\\|?*]/g, "_");
        const gameDir = path.join(screenshotsDir, sanitizedGameTitle);
        finalDir = gameDir;

        // Use achievement name as filename (sanitized)
        const sanitizedAchievementName = achievementName.replace(
          /[<>:"/\\|?*]/g,
          "_"
        );
        filename = `${sanitizedAchievementName}.${this.SCREENSHOT_FORMAT}`;
      } else {
        // Fallback to timestamp-based naming
        const timestamp = Date.now();
        filename = `achievement_screenshot_${timestamp}.${this.SCREENSHOT_FORMAT}`;
      }

      // Ensure directory exists
      if (!fs.existsSync(finalDir)) {
        fs.mkdirSync(finalDir, { recursive: true });
      }

      const screenshotPath = path.join(finalDir, filename);

      // Save the compressed screenshot as JPEG with specified quality
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

      // Get all files recursively from screenshots directory and subdirectories
      const getAllFiles = (
        dir: string
      ): Array<{ name: string; path: string; mtime: Date }> => {
        const files: Array<{ name: string; path: string; mtime: Date }> = [];

        const items = fs.readdirSync(dir);
        for (const item of items) {
          const itemPath = path.join(dir, item);
          const stat = fs.statSync(itemPath);

          if (stat.isDirectory()) {
            // Recursively get files from subdirectories
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

      // Keep only the 50 most recent screenshots (increased from 10 to accommodate multiple games)
      const filesToDelete = allFiles.slice(50);

      for (const file of filesToDelete) {
        try {
          fs.unlinkSync(file.path);
          logger.log(`Cleaned up old screenshot: ${file.name}`);
        } catch (error) {
          logger.error(`Failed to delete screenshot ${file.name}:`, error);
        }
      }

      // Clean up empty directories
      const cleanupEmptyDirs = (dir: string) => {
        if (dir === screenshotsDir) return; // Don't delete the main screenshots directory

        try {
          const items = fs.readdirSync(dir);
          if (items.length === 0) {
            fs.rmdirSync(dir);
            logger.log(`Cleaned up empty directory: ${dir}`);
          }
        } catch (error) {
          // Directory might not be empty or might not exist, ignore
        }
      };

      // Check for empty game directories and clean them up
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
