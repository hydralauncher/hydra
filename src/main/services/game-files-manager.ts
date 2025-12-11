import path from "node:path";
import fs from "node:fs";
import type { GameShop } from "@types";
import { downloadsSublevel, gamesSublevel, levelKeys } from "@main/level";
import { FILE_EXTENSIONS_TO_EXTRACT } from "@shared";
import { SevenZip, ExtractionProgress } from "./7zip";
import { WindowManager } from "./window-manager";
import { publishExtractionCompleteNotification } from "./notifications";
import { logger } from "./logger";

const PROGRESS_THROTTLE_MS = 1000;

export class GameFilesManager {
  private lastProgressUpdate = 0;

  constructor(
    private readonly shop: GameShop,
    private readonly objectId: string
  ) {}

  private get gameKey() {
    return levelKeys.game(this.shop, this.objectId);
  }

  private async updateExtractionProgress(progress: number, force = false) {
    const now = Date.now();

    if (!force && now - this.lastProgressUpdate < PROGRESS_THROTTLE_MS) {
      return;
    }

    this.lastProgressUpdate = now;

    const download = await downloadsSublevel.get(this.gameKey);
    if (!download) return;

    await downloadsSublevel.put(this.gameKey, {
      ...download,
      extractionProgress: progress,
    });

    WindowManager.mainWindow?.webContents.send(
      "on-extraction-progress",
      this.shop,
      this.objectId,
      progress
    );
  }

  private async clearExtractionState() {
    const download = await downloadsSublevel.get(this.gameKey);
    if (!download) return;

    await downloadsSublevel.put(this.gameKey, {
      ...download,
      extracting: false,
      extractionProgress: 0,
    });

    WindowManager.mainWindow?.webContents.send(
      "on-extraction-complete",
      this.shop,
      this.objectId
    );
  }

  private readonly handleProgress = (progress: ExtractionProgress) => {
    this.updateExtractionProgress(progress.percent / 100);
  };

  async extractFilesInDirectory(directoryPath: string) {
    if (!fs.existsSync(directoryPath)) return;
    const files = await fs.promises.readdir(directoryPath);

    const compressedFiles = files.filter((file) =>
      FILE_EXTENSIONS_TO_EXTRACT.some((ext) => file.endsWith(ext))
    );

    const filesToExtract = compressedFiles.filter(
      (file) => /part1\.rar$/i.test(file) || !/part\d+\.rar$/i.test(file)
    );

    if (filesToExtract.length === 0) return;

    await this.updateExtractionProgress(0, true);

    const totalFiles = filesToExtract.length;
    let completedFiles = 0;

    for (const file of filesToExtract) {
      try {
        const result = await SevenZip.extractFile(
          {
            filePath: path.join(directoryPath, file),
            cwd: directoryPath,
            passwords: ["online-fix.me", "steamrip.com"],
          },
          (progress) => {
            const overallProgress =
              (completedFiles + progress.percent / 100) / totalFiles;
            this.updateExtractionProgress(overallProgress);
          }
        );

        if (result.success) {
          completedFiles++;
          await this.updateExtractionProgress(
            completedFiles / totalFiles,
            true
          );
        }
      } catch (err) {
        logger.error(`Failed to extract file: ${file}`, err);
        await this.clearExtractionState();
        return;
      }
    }

    for (const file of compressedFiles) {
      const extractionPath = path.join(directoryPath, file);

      try {
        if (fs.existsSync(extractionPath)) {
          await fs.promises.unlink(extractionPath);
          logger.info(`Deleted archive: ${file}`);
        }
      } catch (err) {
        logger.error(`Failed to delete file: ${file}`, err);
      }
    }
  }

  async setExtractionComplete(publishNotification = true) {
    const [download, game] = await Promise.all([
      downloadsSublevel.get(this.gameKey),
      gamesSublevel.get(this.gameKey),
    ]);

    if (!download) return;

    await downloadsSublevel.put(this.gameKey, {
      ...download,
      extracting: false,
      extractionProgress: 0,
    });

    WindowManager.mainWindow?.webContents.send(
      "on-extraction-complete",
      this.shop,
      this.objectId
    );

    if (publishNotification && game) {
      publishExtractionCompleteNotification(game);
    }
  }

  async extractDownloadedFile() {
    const [download, game] = await Promise.all([
      downloadsSublevel.get(this.gameKey),
      gamesSublevel.get(this.gameKey),
    ]);

    if (!download || !game) return false;

    const filePath = path.join(download.downloadPath, download.folderName!);

    const extractionPath = path.join(
      download.downloadPath,
      path.parse(download.folderName!).name
    );

    await this.updateExtractionProgress(0, true);

    try {
      const result = await SevenZip.extractFile(
        {
          filePath,
          outputPath: extractionPath,
          passwords: ["online-fix.me", "steamrip.com"],
        },
        this.handleProgress
      );

      if (result.success) {
        await this.extractFilesInDirectory(extractionPath);

        if (fs.existsSync(extractionPath) && fs.existsSync(filePath)) {
          try {
            await fs.promises.unlink(filePath);
            logger.info(`Deleted archive: ${download.folderName}`);
          } catch (err) {
            logger.error(`Failed to delete file: ${download.folderName}`, err);
          }
        }

        await downloadsSublevel.put(this.gameKey, {
          ...download,
          folderName: path.parse(download.folderName!).name,
        });

        await this.setExtractionComplete();
      }
    } catch (err) {
      logger.error(`Failed to extract downloaded file: ${filePath}`, err);
      await this.clearExtractionState();
    }

    return true;
  }
}
