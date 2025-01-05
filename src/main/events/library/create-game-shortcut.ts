import { gameRepository } from "@main/repository";
import { registerEvent } from "../register-event";
import { IsNull, Not } from "typeorm";
import createDesktopShortcut from "create-desktop-shortcuts";
import path from "node:path";
import { app } from "electron";
import { removeSymbolsFromName } from "@shared";

const createGameShortcut = async (
  _event: Electron.IpcMainInvokeEvent,
  id: number
): Promise<boolean> => {
  const game = await gameRepository.findOne({
    where: { id, executablePath: Not(IsNull()) },
  });

  if (game) {
    const filePath = game.executablePath;

    const windowVbsPath = app.isPackaged
      ? path.join(process.resourcesPath, "windows.vbs")
      : undefined;

    const options = {
      filePath,
      name: removeSymbolsFromName(game.title),
      outputPath: app.getPath("desktop"),
    };

    return createDesktopShortcut({
      windows: { ...options, VBScriptPath: windowVbsPath },
      linux: options,
      osx: options,
    });
  }

  return false;
};

registerEvent("createGameShortcut", createGameShortcut);
