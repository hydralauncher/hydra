import { gameRepository } from "@main/repository";
import { registerEvent } from "../register-event";
import { IsNull, Not } from "typeorm";
import createDesktopShortcut from "create-desktop-shortcuts";

const createGameShortcut = async (
  _event: Electron.IpcMainInvokeEvent,
  id: number
): Promise<boolean> => {
  const game = await gameRepository.findOne({
    where: { id, executablePath: Not(IsNull()) },
  });

  if (game) {
    const filePath = game.executablePath;
    return createDesktopShortcut({
      windows: { filePath },
      linux: { filePath },
      osx: { filePath },
    });
  }

  return false;
};

registerEvent("createGameShortcut", createGameShortcut);
