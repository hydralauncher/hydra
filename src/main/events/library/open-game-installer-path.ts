import { shell } from "electron";
import path from "node:path";
import { getDownloadsPath } from "../helpers/get-downloads-path";
import { registerEvent } from "../register-event";
import { GameShop } from "@types";
import { downloadsSublevel, levelKeys } from "@main/level";

const openGameInstallerPath = async (
  _event: Electron.IpcMainInvokeEvent,
  shop: GameShop,
  objectId: string
) => {
  const download = await downloadsSublevel.get(levelKeys.game(shop, objectId));

  if (!download || !download.folderName || !download.downloadPath) return true;

  const gamePath = path.join(
    download.downloadPath ?? (await getDownloadsPath()),
    download.folderName!
  );

  shell.showItemInFolder(gamePath);

  return true;
};

registerEvent("openGameInstallerPath", openGameInstallerPath);
