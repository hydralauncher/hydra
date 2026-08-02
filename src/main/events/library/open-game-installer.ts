import { shell } from "electron";
import path from "node:path";
import fs from "node:fs";
import { spawn } from "node:child_process";

import { getDownloadsPath } from "../helpers/get-downloads-path";
import { registerEvent } from "../register-event";
import { db, downloadsSublevel, gamesSublevel, levelKeys } from "@main/level";
import { GameShop, UserPreferences } from "@types";
import { logger, Umu, Wine, CrossOver } from "@main/services";

const launchInstallerWithWine = async (filePath: string): Promise<boolean> => {
  return await new Promise<boolean>((resolve) => {
    const child = spawn("wine", [filePath], {
      detached: true,
      stdio: "ignore",
      shell: false,
    });

    child.once("spawn", () => {
      child.unref();
      resolve(true);
    });

    child.once("error", (error) => {
      logger.error("Failed to execute game installer with wine", error);
      resolve(false);
    });
  });
};

const launchInstallerDirectly = async (filePath: string): Promise<boolean> => {
  return await new Promise<boolean>((resolve) => {
    const child = spawn(filePath, [], {
      detached: true,
      stdio: "ignore",
      shell: false,
    });

    child.once("spawn", () => {
      child.unref();
      resolve(true);
    });

    child.once("error", (error) => {
      logger.error("Failed to execute game installer directly", error);
      resolve(false);
    });
  });
};

const openPathAndCheck = async (filePath: string): Promise<boolean> => {
  const openError = await shell.openPath(filePath);
  return openError.length === 0;
};

const executeGameInstaller = async (
  filePath: string,
  options?: {
    gameId?: string;
    winePrefixPath?: string | null;
    protonPath?: string | null;
    crossoverBottle?: string | null;
  }
) => {
  if (process.platform === "win32") {
    const launchedDirectly = await launchInstallerDirectly(filePath);
    if (launchedDirectly) {
      return true;
    }

    return await openPathAndCheck(filePath);
  }

  if (process.platform === "darwin") {
    // Run exe in the existing CrossOver bottle (files already copied there)
    if (CrossOver.isInstalled()) {
      const bottleName = options?.crossoverBottle ?? CrossOver.getDefaultBottle().name;
      try {
        await CrossOver.launchInBottle(bottleName, filePath);
        return true;
      } catch (error) {
        logger.error("Failed to launch executable in CrossOver bottle", error);
      }
    }
    return await openPathAndCheck(filePath);
  }

  if (process.platform === "linux") {
    try {
      await Umu.launchExecutable(filePath, [], {
        gameId: options?.gameId,
        winePrefixPath: options?.winePrefixPath,
        protonPath: options?.protonPath,
      });
      return true;
    } catch (error) {
      logger.error("Failed to execute game installer with umu-run", error);

      const launchedWithWine = await launchInstallerWithWine(filePath);
      if (launchedWithWine) {
        return true;
      }

      return await openPathAndCheck(filePath);
    }
  }

  return await openPathAndCheck(filePath);
};

const cleanupOriginalDownload = async (
  gamePath: string,
  shop: GameShop,
  objectId: string
) => {
  try {
    const downloadKey = levelKeys.game(shop, objectId);
    const [download, userPreferences] = await Promise.all([
      downloadsSublevel.get(downloadKey),
      db.get<string, UserPreferences | null>(levelKeys.userPreferences, {
        valueEncoding: "json",
      }),
    ]);

    const shouldDelete =
      download?.automaticallyDeleteArchiveFiles ??
      userPreferences?.deleteArchiveFilesAfterExtractionByDefault ??
      false;

    if (shouldDelete && fs.existsSync(gamePath)) {
      await fs.promises.rm(gamePath, { recursive: true, force: true });
      logger.info(`Cleaned up original download folder after copying to CrossOver bottle: ${gamePath}`);

      // Clear installer size since the original files are gone
      const game = await gamesSublevel.get(downloadKey).catch(() => null);
      if (game) {
        await gamesSublevel.put(downloadKey, {
          ...game,
          installerSizeInBytes: null,
        });
      }
    }
  } catch (error) {
    logger.error("Failed to clean up original download folder after bottle copy", error);
  }
};

const openGameInstaller = async (
  _event: Electron.IpcMainInvokeEvent,
  shop: GameShop,
  objectId: string
) => {
  const downloadKey = levelKeys.game(shop, objectId);
  const download = await downloadsSublevel.get(downloadKey);
  const game = await gamesSublevel.get(downloadKey).catch(() => null);
  const effectiveWinePrefixPath = Wine.getEffectivePrefixPath(
    game?.winePrefixPath,
    objectId
  );

  if (!download?.folderName) return true;

  const gamePath = path.join(
    download.downloadPath ?? (await getDownloadsPath()),
    download.folderName
  );

  if (!fs.existsSync(gamePath)) {
    return true;
  }

  if (process.platform === "darwin") {
    // On macOS, copy game data into the CrossOver bottle, then run installer
    if (CrossOver.isInstalled() && game) {
      const bottleName = game.crossoverBottle ?? CrossOver.getDefaultBottle().name;

      // Copy game files into the bottle's Program Files
      let bottleGamePath: string;
      try {
        bottleGamePath = CrossOver.copyGameToBottle(
          bottleName,
          gamePath,
          game.title
        );
      } catch (error) {
        logger.error("Failed to copy game files to CrossOver bottle", error);
        shell.openPath(gamePath);
        return true;
      }

      // Find installer exe inside the bottle copy
      if (fs.lstatSync(bottleGamePath).isDirectory()) {
        const setupPath = path.join(bottleGamePath, "setup.exe");
        if (fs.existsSync(setupPath)) {
          const result = await executeGameInstaller(setupPath, {
            gameId: objectId,
            crossoverBottle: bottleName,
          });

          // Clean up original download folder after copying to bottle
          await cleanupOriginalDownload(gamePath, shop, objectId);
          return result;
        }

        const fileNames = fs.readdirSync(bottleGamePath);
        const exeFiles = fileNames.filter(
          (fileName: string) => path.extname(fileName).toLowerCase() === ".exe"
        );

        if (exeFiles.length === 1) {
          const result = await executeGameInstaller(
            path.join(bottleGamePath, exeFiles[0]),
            {
              gameId: objectId,
              crossoverBottle: bottleName,
            }
          );

          // Clean up original download folder after copying to bottle
          await cleanupOriginalDownload(gamePath, shop, objectId);
          return result;
        }
      }
    }

    shell.openPath(gamePath);
    return true;
  }

  if (fs.lstatSync(gamePath).isFile()) {
    shell.showItemInFolder(gamePath);
    return true;
  }

  const setupPath = path.join(gamePath, "setup.exe");
  if (fs.existsSync(setupPath)) {
    return await executeGameInstaller(setupPath, {
      gameId: objectId,
      winePrefixPath: effectiveWinePrefixPath,
      protonPath: game?.protonPath,
    });
  }

  const gamePathFileNames = fs.readdirSync(gamePath);
  const gamePathExecutableFiles = gamePathFileNames.filter(
    (fileName: string) => path.extname(fileName).toLowerCase() === ".exe"
  );

  if (gamePathExecutableFiles.length === 1) {
    return await executeGameInstaller(
      path.join(gamePath, gamePathExecutableFiles[0]),
      {
        gameId: objectId,
        winePrefixPath: effectiveWinePrefixPath,
        protonPath: game?.protonPath,
      }
    );
  }

  shell.openPath(gamePath);
  return true;
};

registerEvent("openGameInstaller", openGameInstaller);
