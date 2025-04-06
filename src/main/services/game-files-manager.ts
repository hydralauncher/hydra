import path from "node:path";
import fs from "node:fs";
import type { GameShop } from "@types";
import { downloadsSublevel, gamesSublevel, levelKeys } from "@main/level";
import { FILE_EXTENSIONS_TO_EXTRACT } from "@shared";
import { SevenZip } from "./7zip";
import { WindowManager } from "./window-manager";
import { publishExtractionCompleteNotification } from "./notifications";
import { logger } from "./logger";

export class GameFilesManager {
  constructor(
    private readonly shop: GameShop,
    private readonly objectId: string
  ) {}

  private async clearExtractionState() {
    const gameKey = levelKeys.game(this.shop, this.objectId);
    const download = await downloadsSublevel.get(gameKey);

    await downloadsSublevel.put(gameKey, {
      ...download!,
      extracting: false,
    });

    WindowManager.mainWindow?.webContents.send(
      "on-extraction-complete",
      this.shop,
      this.objectId
    );
  }

  async extractFilesInDirectory(directoryPath: string) {
    if (!fs.existsSync(directoryPath)) return;
    const files = await fs.promises.readdir(directoryPath);

    const compressedFiles = files.filter((file) =>
      FILE_EXTENSIONS_TO_EXTRACT.some((ext) => file.endsWith(ext))
    );

    const filesToExtract = compressedFiles.filter(
      (file) => /part1\.rar$/i.test(file) || !/part\d+\.rar$/i.test(file)
    );

    await Promise.all(
      filesToExtract.map((file) => {
        return new Promise((resolve, reject) => {
          SevenZip.extractFile(
            {
              filePath: path.join(directoryPath, file),
              cwd: directoryPath,
              passwords: ["online-fix.me", "steamrip.com"],
            },
            () => {
              resolve(true);
            },
            () => {
              reject(new Error(`Failed to extract file: ${file}`));
              this.clearExtractionState();
            }
          );
        });
      })
    );

    compressedFiles.forEach((file) => {
      const extractionPath = path.join(directoryPath, file);

      if (fs.existsSync(extractionPath)) {
        fs.unlink(extractionPath, (err) => {
          if (err) {
            logger.error(`Failed to delete file: ${file}`, err);

            this.clearExtractionState();
          }
        });
      }
    });
  }

  async setExtractionComplete(publishNotification = true) {
    const gameKey = levelKeys.game(this.shop, this.objectId);

    const [download, game] = await Promise.all([
      downloadsSublevel.get(gameKey),
      gamesSublevel.get(gameKey),
    ]);

    await downloadsSublevel.put(gameKey, {
      ...download!,
      extracting: false,
    });

    WindowManager.mainWindow?.webContents.send(
      "on-extraction-complete",
      this.shop,
      this.objectId
    );

    if (publishNotification) {
      publishExtractionCompleteNotification(game!);
    }
  }

  async extractDownloadedFile() {
    const gameKey = levelKeys.game(this.shop, this.objectId);

    const [download, game] = await Promise.all([
      downloadsSublevel.get(gameKey),
      gamesSublevel.get(gameKey),
    ]);

    if (!download || !game) return false;

    const filePath = path.join(download.downloadPath, download.folderName!);

    const extractionPath = path.join(
      download.downloadPath,
      path.parse(download.folderName!).name
    );

    SevenZip.extractFile(
      {
        filePath,
        outputPath: extractionPath,
        passwords: ["online-fix.me", "steamrip.com"],
      },
      async () => {
        await this.extractFilesInDirectory(extractionPath);

        if (fs.existsSync(extractionPath) && fs.existsSync(filePath)) {
          fs.unlink(filePath, (err) => {
            if (err) {
              logger.error(
                `Failed to delete file: ${download.folderName}`,
                err
              );

              this.clearExtractionState();
            }
          });
        }

        await downloadsSublevel.put(gameKey, {
          ...download!,
          folderName: path.parse(download.folderName!).name,
        });

        this.setExtractionComplete();
      },
      () => {
        this.clearExtractionState();
      }
    );

    return true;
  }
}
