import { registerEvent } from "../register-event";
import createDesktopShortcut from "create-desktop-shortcuts";
import path from "node:path";
import { app } from "electron";
import { removeSymbolsFromName } from "@shared";
import { GameShop } from "@types";
import { gamesSublevel, levelKeys } from "@main/level";

const createGameShortcut = async (
  _event: Electron.IpcMainInvokeEvent,
  shop: GameShop,
  objectId: string
): Promise<boolean> => {
  const gameKey = levelKeys.game(shop, objectId);
  const game = await gamesSublevel.get(gameKey);

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
