import { shell } from "electron";
import { registerEvent } from "../register-event";
import { gamesSublevel, levelKeys } from "@main/level";
import { GameShop } from "@types";

const openGameExecutablePath = async (
  _event: Electron.IpcMainInvokeEvent,
  shop: GameShop,
  objectId: string
) => {
  const game = await gamesSublevel.get(levelKeys.game(shop, objectId));

  if (!game || !game.executablePath) return;

  shell.showItemInFolder(game.executablePath);
};

registerEvent("openGameExecutablePath", openGameExecutablePath);
