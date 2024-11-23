import { shell } from "electron";
import { gameRepository } from "@main/repository";
import { registerEvent } from "../register-event";

const openGameExecutablePath = async (
  _event: Electron.IpcMainInvokeEvent,
  gameId: number
) => {
  const game = await gameRepository.findOne({
    where: { id: gameId, isDeleted: false },
  });

  if (!game || !game.executablePath) return;

  shell.showItemInFolder(game.executablePath);
};

registerEvent("openGameExecutablePath", openGameExecutablePath);
