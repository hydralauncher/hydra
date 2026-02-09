import { shell } from "electron";
import path from "node:path";
import fs from "node:fs";
import { spawn } from "node:child_process";

import { getDownloadsPath } from "../helpers/get-downloads-path";
import { registerEvent } from "../register-event";
import { downloadsSublevel, levelKeys } from "@main/level";
import { GameShop } from "@types";
import { logger, Umu } from "@main/services";

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

const openPathAndCheck = async (filePath: string): Promise<boolean> => {
  const openError = await shell.openPath(filePath);
  return openError.length === 0;
};

const executeGameInstaller = async (filePath: string) => {
  if (process.platform === "win32") {
    shell.openPath(filePath);
    return true;
  }

  if (process.platform === "linux") {
    try {
      await Umu.launchExecutable(filePath);
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

const openGameInstaller = async (
  _event: Electron.IpcMainInvokeEvent,
  shop: GameShop,
  objectId: string
) => {
  const downloadKey = levelKeys.game(shop, objectId);
  const download = await downloadsSublevel.get(downloadKey);

  if (!download?.folderName) return true;

  const gamePath = path.join(
    download.downloadPath ?? (await getDownloadsPath()),
    download.folderName
  );

  if (!fs.existsSync(gamePath)) {
    return true;
  }

  if (process.platform === "darwin") {
    shell.openPath(gamePath);
    return true;
  }

  if (fs.lstatSync(gamePath).isFile()) {
    shell.showItemInFolder(gamePath);
    return true;
  }

  const setupPath = path.join(gamePath, "setup.exe");
  if (fs.existsSync(setupPath)) {
    return await executeGameInstaller(setupPath);
  }

  const gamePathFileNames = fs.readdirSync(gamePath);
  const gamePathExecutableFiles = gamePathFileNames.filter(
    (fileName: string) => path.extname(fileName).toLowerCase() === ".exe"
  );

  if (gamePathExecutableFiles.length === 1) {
    return await executeGameInstaller(
      path.join(gamePath, gamePathExecutableFiles[0])
    );
  }

  shell.openPath(gamePath);
  return true;
};

registerEvent("openGameInstaller", openGameInstaller);
