import { shell } from "electron";
import path from "node:path";
import { getDownloadsPath } from "../helpers/get-downloads-path";
import { registerEvent } from "../register-event";
import { GameShop } from "@types";
import { gamesSublevel, levelKeys } from "@main/level";

const openGameInstallerPath = async (
  _event: Electron.IpcMainInvokeEvent,
  shop: GameShop,
  objectId: string
) => {
  const game = await gamesSublevel.get(levelKeys.game(shop, objectId));

  if (!game || !game.folderName || !game.downloadPath) return true;

  const gamePath = path.join(
    game.downloadPath ?? (await getDownloadsPath()),
    game.folderName!
  );

  shell.showItemInFolder(gamePath);

  return true;
};

registerEvent("openGameInstallerPath", openGameInstallerPath);
