import { shell } from "electron";
import path from "node:path";
import fs from "node:fs";
import { writeFile } from "node:fs/promises";
import { spawnSync, exec } from "node:child_process";

import { gameRepository } from "@main/repository";

import { generateYML } from "../helpers/generate-lutris-yaml";
import { getDownloadsPath } from "../helpers/get-downloads-path";
import { registerEvent } from "../register-event";

const executeGameInsaller = (filePath: string) => {
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
  gameId: number
) => {
  const game = await gameRepository.findOne({
    where: { id: gameId, isDeleted: false },
  });

  if (!game || !game.folderName) return true;

  const gamePath = path.join(
    game.downloadPath ?? (await getDownloadsPath()),
    game.folderName!
  );

  if (!fs.existsSync(gamePath)) {
    await gameRepository.update({ id: gameId }, { status: null });
    return true;
  }

  if (fs.lstatSync(gamePath).isFile()) {
    return executeGameInsaller(gamePath);
  }

  const setupPath = path.join(gamePath, "setup.exe");
  if (fs.existsSync(setupPath)) {
    return executeGameInsaller(setupPath);
  }

  const gamePathFileNames = fs.readdirSync(gamePath);
  const gameAlternativeSetupPath = gamePathFileNames.find(
    (fileName: string) => path.extname(fileName).toLowerCase() === ".exe"
  );

  if (gameAlternativeSetupPath) {
    return executeGameInsaller(path.join(gamePath, gameAlternativeSetupPath));
  }

  if (spawnSync("which", ["lutris"]).status === 0) {
    const ymlPath = path.join(gamePath, "setup.yml");
    await writeFile(ymlPath, generateYML(game));
    exec(`lutris --install "${ymlPath}"`);
    return true;
  }

  shell.openPath(gamePath);
  return true;
};

registerEvent("openGameInstaller", openGameInstaller);
