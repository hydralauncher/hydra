import { shell } from "electron";
import path from "node:path";
import fs from "node:fs";
import { spawnSync, exec } from "node:child_process";

import { getDownloadsPath } from "../helpers/get-downloads-path";
import { registerEvent } from "../register-event";
import { downloadsSublevel, levelKeys } from "@main/level";
import { GameShop } from "@types";

const executeGameInstaller = (filePath: string) => {
  if (process.platform === "win32") {
    shell.openPath(filePath);
    return true;
  }

  if (spawnSync("which", ["wine"]).status === 0) {
    exec(`wine "${filePath}"`);
    return true;
  }

  return false;
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
    await downloadsSublevel.del(downloadKey);
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
    return executeGameInstaller(setupPath);
  }

  const gamePathFileNames = fs.readdirSync(gamePath);
  const gamePathExecutableFiles = gamePathFileNames.filter(
    (fileName: string) => path.extname(fileName).toLowerCase() === ".exe"
  );

  if (gamePathExecutableFiles.length === 1) {
    return executeGameInstaller(
      path.join(gamePath, gamePathExecutableFiles[0])
    );
  }

  shell.openPath(gamePath);
  return true;
};

registerEvent("openGameInstaller", openGameInstaller);
