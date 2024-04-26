import path from "node:path";

import { gameRepository } from "@main/repository";

import { registerEvent } from "../register-event";
import { getProcesses } from "@main/helpers";
import { app } from "electron";

const closeGame = async (
  _event: Electron.IpcMainInvokeEvent,
  gameId: number
) => {
  const processes = await getProcesses(app.isPackaged);
  const game = await gameRepository.findOne({ where: { id: gameId } });

  const gameProcess = processes.find((runningProcess) => {
    const basename = path.win32.basename(game.executablePath);
    const basenameWithoutExtension = path.win32.basename(
      game.executablePath,
      path.extname(game.executablePath)
    );

    if (process.platform === "win32") {
      return runningProcess.name === basename;
    }

    return [basename, basenameWithoutExtension].includes(runningProcess.name);
  });

  if (gameProcess) return process.kill(gameProcess.pid);
  return false;
};

registerEvent(closeGame, {
  name: "closeGame",
});
