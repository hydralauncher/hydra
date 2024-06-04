import { shell } from "electron";
import path from "node:path";
import { gameRepository } from "@main/repository";
import { registerEvent } from "../register-event";

const openGameExecutablePath = async (
  _event: Electron.IpcMainInvokeEvent,
  gameId: number
) => {
  const game = await gameRepository.findOne({
    where: { id: gameId, isDeleted: false },
  });

  if (!game || !game.executablePath) return true;

  const gamePath = path.join(game.executablePath, "../");

  shell.openPath(gamePath);
  return true;
};

registerEvent("openGameExecutablePath", openGameExecutablePath);
