import { shell } from "electron";
import fs from "node:fs";
import { spawn } from "node:child_process";

import { registerEvent } from "../register-event";
import { downloadsSublevel, gamesSublevel, levelKeys } from "@main/level";
import type { Download, GameShop } from "@types";
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
  onCancel: () => void;
}

interface InstallerLaunchResult {
  launched: boolean;
  tracked: boolean;
}

const ELEVATED_INSTALLER_COMMAND =
  "Start-Process -FilePath $env:HYDRA_INSTALLER_PATH -WorkingDirectory (Split-Path -Parent $env:HYDRA_INSTALLER_PATH) -Verb RunAs -Wait";

const spawnInstaller = async (
  command: string,
  args: string[],
  onExit: (code: number | null) => void,
  failureMessage: string,
  env?: NodeJS.ProcessEnv
): Promise<boolean> => {
  return await new Promise<boolean>((resolve) => {
    const child = spawn(command, args, {
      detached: true,
      stdio: "ignore",
      shell: false,
      windowsHide: true,
      env: env ?? process.env,
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

const launchInstallerElevated = async (
  filePath: string,
  options: InstallerLaunchOptions
) =>
  spawnInstaller(
    "powershell.exe",
    [
      "-NoProfile",
      "-NonInteractive",
      "-ExecutionPolicy",
      "Bypass",
      "-Command",
      ELEVATED_INSTALLER_COMMAND,
    ],
    (code) => (code === 0 ? options.onExit() : options.onCancel()),
    "Failed to execute game installer with elevation",
    { ...process.env, HYDRA_INSTALLER_PATH: filePath }
  );

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

const openUntracked = async (
  filePath: string
): Promise<InstallerLaunchResult> => ({
  launched: await openPathAndCheck(filePath),
  tracked: false,
});

const executeGameInstaller = async (
  filePath: string,
  options: InstallerLaunchOptions
): Promise<InstallerLaunchResult> => {
  if (process.platform === "win32") {
    const launchedDirectly = await spawnInstaller(
      filePath,
      [],
      options.onExit,
      "Failed to execute game installer directly"
    );
    if (launchedDirectly) return { launched: true, tracked: true };

    const launchedElevated = await launchInstallerElevated(filePath, options);
    if (launchedElevated) return { launched: true, tracked: true };

    return await openUntracked(filePath);
  }

  if (process.platform === "linux") {
    try {
      await launchInstallerWithUmu(filePath, options);
      return { launched: true, tracked: true };
    } catch (error) {
      logger.error("Failed to execute game installer with umu-run", error);

      const launchedWithWine = await spawnInstaller(
        "wine",
        [filePath],
        options.onExit,
        "Failed to execute game installer with wine"
      );
      if (launchedWithWine) return { launched: true, tracked: true };

      return await openUntracked(filePath);
    }
  }

  return await openUntracked(filePath);
};

const updateInstallerState = async (
  gameKey: string,
  state: Pick<Download, "installerLaunched" | "installerRunning">
) => {
  const download = await downloadsSublevel.get(gameKey);
  if (!download) return;

  await downloadsSublevel.put(gameKey, { ...download, ...state });
  WindowManager.sendDownloadsUpdated();
};

const handleInstallerExit = async (
  shop: GameShop,
  objectId: string,
  installerStartedAt: number,
  winePrefixPath: string | null
) => {
  await updateInstallerState(levelKeys.game(shop, objectId), {
    installerRunning: false,
  });

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
  let installerFinished = false;
  let launchRecorded: Promise<void> = Promise.resolve();

  const afterLaunchRecorded = (callback: () => Promise<void>) => {
    installerFinished = true;
    void launchRecorded.then(callback).catch((error) => {
      logger.error("Failed to update the installer state", error);
    });
  };

  const { launched, tracked } = await executeGameInstaller(installerPath, {
    gameId: objectId,
    winePrefixPath,
    protonPath: game?.protonPath,
    onExit: () =>
      afterLaunchRecorded(() =>
        handleInstallerExit(shop, objectId, installerStartedAt, winePrefixPath)
      ),
    onCancel: () =>
      afterLaunchRecorded(() =>
        updateInstallerState(gameKey, {
          installerLaunched: false,
          installerRunning: false,
        })
      ),
  });

  if (launched) {
    launchRecorded = updateInstallerState(gameKey, {
      installerLaunched: true,
      installerRunning: tracked && !installerFinished,
    });
    await launchRecorded;
  }

  return launched;
};

registerEvent("openGameInstaller", openGameInstaller);
