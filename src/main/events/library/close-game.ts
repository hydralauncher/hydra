import path from "node:path";

import { gameRepository } from "@main/repository";
import { getProcesses } from "@main/helpers";

import { registerEvent } from "../register-event";

const closeGame = async (
  _event: Electron.IpcMainInvokeEvent,
  gameId: number
) => {
  const processes = await getProcesses();
  const game = await gameRepository.findOne({
    where: { id: gameId, isDeleted: false },
  });

  if (!game) return false;

  const executablePath = game.executablePath!;

  const basename = path.win32.basename(executablePath);
  const basenameWithoutExtension = path.win32.basename(
    executablePath,
    path.extname(executablePath)
  );

  const gameProcess = processes.find((runningProcess) => {
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
