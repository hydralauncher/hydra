import { gameRepository } from "@main/repository";
import { generateYML } from "../helpers/generate-lutris-yaml";
import path from "node:path";
import fs from "node:fs";
import { writeFile } from "node:fs/promises";
import { spawnSync, exec } from "node:child_process";

import { registerEvent } from "../register-event";
import { shell } from "electron";
import { getDownloadsPath } from "../helpers/get-downloads-path";

const openGameInstaller = async (
  _event: Electron.IpcMainInvokeEvent,
  gameId: number,
) => {
  const game = await gameRepository.findOne({ where: { id: gameId } });

  if (!game || !game.folderName) return true;

  const gamePath = path.join(
    game.downloadPath ?? (await getDownloadsPath()),
    game.folderName,
  );

  if (!fs.existsSync(gamePath)) {
    await gameRepository.update({ id: gameId }, { status: null });
    return true;
  }

  const setupPath = path.join(gamePath, "setup.exe");
  if (!fs.existsSync(setupPath)) {
    shell.openPath(gamePath);
    return true;
  }

  if (process.platform === "win32") {
    shell.openPath(setupPath);
    return true;
  }

  if (spawnSync("which", ["lutris"]).status === 0) {
    const ymlPath = path.join(gamePath, "setup.yml");
    await writeFile(ymlPath, generateYML(game));
    exec(`lutris --install "${ymlPath}"`);
    return true;
  }

  if (spawnSync("which", ["wine"]).status === 0) {
    exec(`wine "${setupPath}"`);
    return true;
  }

  return false;
};

registerEvent(openGameInstaller, {
  name: "openGameInstaller",
});
