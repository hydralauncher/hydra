import { shell } from "electron";
import fs from "node:fs";
import { spawn } from "node:child_process";

import { registerEvent } from "../register-event";
import { downloadsSublevel, gamesSublevel, levelKeys } from "@main/level";
import { GameShop } from "@types";
import {
  GameFilesManager,
  logger,
  Umu,
  Wine,
  WindowManager,
} from "@main/services";
import {
  findDownloadInstaller,
  getDownloadFolderPath,
} from "@main/helpers/find-game-installer";

interface InstallerLaunchOptions {
  gameId?: string;
  winePrefixPath?: string | null;
  protonPath?: string | null;
  onExit: () => void;
}

const spawnInstaller = async (
  command: string,
  args: string[],
  onExit: () => void,
  failureMessage: string
): Promise<boolean> => {
  return await new Promise<boolean>((resolve) => {
    const child = spawn(command, args, {
      detached: true,
      stdio: "ignore",
      shell: false,
    });

    child.once("spawn", () => {
      child.once("exit", onExit);
      child.unref();
      resolve(true);
    });

    child.once("error", (error) => {
      logger.error(failureMessage, error);
      resolve(false);
    });
  });
};

const openPathAndCheck = async (filePath: string): Promise<boolean> => {
  const openError = await shell.openPath(filePath);
  return openError.length === 0;
};

const launchInstallerWithUmu = async (
  filePath: string,
  options: InstallerLaunchOptions
) => {
  let launched = false;

  await Umu.launchExecutable(filePath, [], {
    gameId: options.gameId,
    winePrefixPath: options.winePrefixPath,
    protonPath: options.protonPath,
    onExit: () => {
      if (launched) options.onExit();
    },
  });

  launched = true;
};

const executeGameInstaller = async (
  filePath: string,
  options: InstallerLaunchOptions
) => {
  if (process.platform === "win32") {
    const launchedDirectly = await spawnInstaller(
      filePath,
      [],
      options.onExit,
      "Failed to execute game installer directly"
    );
    if (launchedDirectly) {
      return true;
    }

    return await openPathAndCheck(filePath);
  }

  if (process.platform === "linux") {
    try {
      await launchInstallerWithUmu(filePath, options);
      return true;
    } catch (error) {
      logger.error("Failed to execute game installer with umu-run", error);

      const launchedWithWine = await spawnInstaller(
        "wine",
        [filePath],
        options.onExit,
        "Failed to execute game installer with wine"
      );
      if (launchedWithWine) {
        return true;
      }

      return await openPathAndCheck(filePath);
    }
  }

  return await openPathAndCheck(filePath);
};

const markInstallerLaunched = async (gameKey: string) => {
  const download = await downloadsSublevel.get(gameKey);
  if (!download) return;

  await downloadsSublevel.put(gameKey, {
    ...download,
    installerLaunched: true,
  });
  WindowManager.sendDownloadsUpdated();
};

const handleInstallerExit = async (
  shop: GameShop,
  objectId: string,
  installerStartedAt: number,
  winePrefixPath: string | null
) => {
  const executableFound = await new GameFilesManager(
    shop,
    objectId
  ).searchAndBindInstalledExecutable(installerStartedAt, winePrefixPath);

  WindowManager.sendToAppWindows("on-library-batch-complete");
  WindowManager.sendToAppWindows(
    "on-game-installer-closed",
    shop,
    objectId,
    executableFound
  );
};

const openGameInstaller = async (
  _event: Electron.IpcMainInvokeEvent,
  shop: GameShop,
  objectId: string
) => {
  const gameKey = levelKeys.game(shop, objectId);
  const download = await downloadsSublevel.get(gameKey);
  const game = await gamesSublevel.get(gameKey).catch(() => null);
  const winePrefixPath = Wine.getEffectivePrefixPath(
    game?.winePrefixPath,
    objectId
  );

  const gamePath = download ? await getDownloadFolderPath(download) : null;

  if (!gamePath || !fs.existsSync(gamePath)) {
    return true;
  }

  if (fs.lstatSync(gamePath).isFile()) {
    shell.showItemInFolder(gamePath);
    return true;
  }

  const installerPath = await findDownloadInstaller(download);

  if (!installerPath) {
    shell.openPath(gamePath);
    return true;
  }

  const installerStartedAt = Date.now();

  const launched = await executeGameInstaller(installerPath, {
    gameId: objectId,
    winePrefixPath,
    protonPath: game?.protonPath,
    onExit: () => {
      void handleInstallerExit(
        shop,
        objectId,
        installerStartedAt,
        winePrefixPath
      ).catch((error) => {
        logger.error("Failed to detect the installed game", error);
      });
    },
  });

  if (launched) {
    await markInstallerLaunched(gameKey);
  }

  return launched;
};

registerEvent("openGameInstaller", openGameInstaller);
