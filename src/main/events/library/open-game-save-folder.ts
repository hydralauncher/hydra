import { shell } from "electron";
import { registerEvent } from "../register-event";
import type { GameShop } from "@types";
import fs from "node:fs";

const openGameSaveFolder = async (
  _event: Electron.IpcMainInvokeEvent,
  _shop: GameShop,
  _objectId: string,
  saveFolderPath: string
): Promise<boolean> => {
  if (!saveFolderPath) return false;

  try {
    if (fs.existsSync(saveFolderPath)) {
      await shell.openPath(saveFolderPath);
      return true;
    }
  } catch {
    return false;
  }

  return false;
};

registerEvent("openGameSaveFolder", openGameSaveFolder);
