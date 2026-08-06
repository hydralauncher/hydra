import fs from "node:fs";
import path from "node:path";
import https from "node:https";
import { logger } from "./logger";
import { SystemPath } from "./system-path";
import { Umu } from "./umu";

export interface RedistDownloadProgress {
  packageName: string;
  bytesDownloaded: number;
  totalBytes: number;
  percentage: number;
  speed: number;
}

const REDIST_BASE_URL =
  "https://raw.githubusercontent.com/hydralauncher/hydra-common-redist/main";

export class RedistManager {
  private static getCacheDirectory(): string {
    const cacheDir = path.join(SystemPath.getPath("userData"), "redist-cache");
    if (!fs.existsSync(cacheDir)) {
      fs.mkdirSync(cacheDir, { recursive: true });
    }
    return cacheDir;
  }

  public static async downloadRedist(
    packageName: string,
    onProgress?: (progress: RedistDownloadProgress) => void
  ): Promise<string> {
    const cacheDir = this.getCacheDirectory();
    const targetFile = path.join(cacheDir, packageName);

    if (fs.existsSync(targetFile)) {
      const stats = fs.statSync(targetFile);
      if (stats.size > 0) {
        logger.info("Using cached redistributable installer", { targetFile });
        onProgress?.({
          packageName,
          bytesDownloaded: stats.size,
          totalBytes: stats.size,
          percentage: 100,
          speed: 0,
        });
        return targetFile;
      }
    }

    const tempFile = `${targetFile}.tmp`;
    const url = `${REDIST_BASE_URL}/${packageName}`;

    logger.info("Downloading redistributable package", { packageName, url });

    return new Promise<string>((resolve, reject) => {
      const request = https.get(url, (response) => {
        if (
          response.statusCode &&
          (response.statusCode < 200 || response.statusCode >= 300)
        ) {
          reject(
            new Error(
              `Failed to download ${packageName}: HTTP ${response.statusCode}`
            )
          );
          return;
        }

        const totalBytes = Number.parseInt(
          response.headers["content-length"] ?? "0",
          10
        );
        let downloadedBytes = 0;
        let lastTime = Date.now();
        let lastDownloaded = 0;

        const fileStream = fs.createWriteStream(tempFile);

        response.on("data", (chunk: Buffer) => {
          downloadedBytes += chunk.length;
          const now = Date.now();
          const timeDiff = (now - lastTime) / 1000;

          let speed = 0;
          if (timeDiff >= 0.5) {
            speed = (downloadedBytes - lastDownloaded) / timeDiff;
            lastTime = now;
            lastDownloaded = downloadedBytes;
          }

          const percentage =
            totalBytes > 0
              ? Math.min(100, (downloadedBytes / totalBytes) * 100)
              : 0;

          onProgress?.({
            packageName,
            bytesDownloaded: downloadedBytes,
            totalBytes,
            percentage,
            speed,
          });
        });

        response.pipe(fileStream);

        fileStream.on("finish", () => {
          fileStream.close(() => {
            fs.renameSync(tempFile, targetFile);
            logger.info("Redistributable package downloaded successfully", {
              targetFile,
            });
            resolve(targetFile);
          });
        });

        fileStream.on("error", (error) => {
          if (fs.existsSync(tempFile)) {
            fs.unlinkSync(tempFile);
          }
          reject(error);
        });
      });

      request.on("error", (error) => {
        if (fs.existsSync(tempFile)) {
          fs.unlinkSync(tempFile);
        }
        reject(error);
      });
    });
  }

  public static async installRedist(
    installerPath: string,
    silentArgs: string[],
    winePrefixPath: string
  ): Promise<boolean> {
    logger.info("Installing redistributable into prefix", {
      installerPath,
      silentArgs,
      winePrefixPath,
    });

    try {
      await Umu.launchExecutable(installerPath, silentArgs, {
        winePrefixPath,
      });
      logger.info("Redistributable installation finished", { installerPath });
      return true;
    } catch (error) {
      logger.error("Failed to install redistributable", {
        installerPath,
        error,
      });
      return false;
    }
  }
}
