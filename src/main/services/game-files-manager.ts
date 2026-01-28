import path from "node:path";
import fs from "node:fs";
import type { GameShop } from "@types";
import { downloadsSublevel, gamesSublevel, levelKeys } from "@main/level";
import { FILE_EXTENSIONS_TO_EXTRACT } from "@shared";
import { SevenZip, ExtractionProgress } from "./7zip";
import { WindowManager } from "./window-manager";
import { publishExtractionCompleteNotification } from "./notifications";
import { logger } from "./logger";
import { GameExecutables } from "./game-executables";
import createDesktopShortcut from "create-desktop-shortcuts";
import { app } from "electron";
import { removeSymbolsFromName } from "@shared";
import { SystemPath } from "./system-path";

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

    const archivePaths = compressedFiles
      .map((file) => path.join(directoryPath, file))
      .filter((archivePath) => fs.existsSync(archivePath));

    if (archivePaths.length > 0) {
      WindowManager.mainWindow?.webContents.send(
        "on-archive-deletion-prompt",
        archivePaths
      );
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

    await this.searchAndBindExecutable();
  }

  async searchAndBindExecutable(): Promise<void> {
    try {
      const [download, game] = await Promise.all([
        downloadsSublevel.get(this.gameKey),
        gamesSublevel.get(this.gameKey),
      ]);

      if (!download || !game || game.executablePath) {
        return;
      }

      const executableNames = GameExecutables.getExecutablesForGame(
        this.objectId
      );

      if (!executableNames || executableNames.length === 0) {
        return;
      }

      if (!download.folderName) {
        return;
      }

      const gameFolderPath = path.join(
        download.downloadPath,
        download.folderName
      );

      if (!fs.existsSync(gameFolderPath)) {
        return;
      }

      const foundExePath = await this.findExecutableInFolder(
        gameFolderPath,
        executableNames
      );

      if (foundExePath) {
        logger.info(
          `[GameFilesManager] Auto-detected executable for ${this.objectId}: ${foundExePath}`
        );

        await gamesSublevel.put(this.gameKey, {
          ...game,
          executablePath: foundExePath,
        });

        WindowManager.mainWindow?.webContents.send("on-library-batch-complete");

        await this.createDesktopShortcutForGame(game.title, foundExePath);
      }
    } catch (err) {
      logger.error(
        `[GameFilesManager] Error searching for executable: ${this.objectId}`,
        err
      );
    }
  }

  private async createDesktopShortcutForGame(
    gameTitle: string,
    executablePath: string
  ): Promise<void> {
    try {
      const windowVbsPath = app.isPackaged
        ? path.join(process.resourcesPath, "windows.vbs")
        : undefined;

      const options = {
        filePath: executablePath,
        name: removeSymbolsFromName(gameTitle),
        outputPath: SystemPath.getPath("desktop"),
      };

      const success = createDesktopShortcut({
        windows: { ...options, VBScriptPath: windowVbsPath },
        linux: options,
        osx: options,
      });

      if (success) {
        logger.info(
          `[GameFilesManager] Created desktop shortcut for ${this.objectId}`
        );
      }
    } catch (err) {
      logger.error(
        `[GameFilesManager] Error creating desktop shortcut: ${this.objectId}`,
        err
      );
    }
  }

  private async findExecutableInFolder(
    folderPath: string,
    executableNames: string[]
  ): Promise<string | null> {
    const normalizedNames = new Set(
      executableNames.map((name) => name.toLowerCase())
    );

    try {
      const entries = await fs.promises.readdir(folderPath, {
        withFileTypes: true,
        recursive: true,
      });

      for (const entry of entries) {
        if (!entry.isFile()) continue;

        const fileName = entry.name.toLowerCase();

        if (normalizedNames.has(fileName)) {
          const parentPath =
            "parentPath" in entry
              ? entry.parentPath
              : (entry as unknown as { path?: string }).path || folderPath;

          return path.join(parentPath, entry.name);
        }
      }
    } catch {
      // Silently fail if folder cannot be read
    }

    return null;
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
          WindowManager.mainWindow?.webContents.send(
            "on-archive-deletion-prompt",
            [filePath]
          );
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
