import fs from "node:fs";

import { registerEvent } from "../register-event";
import { downloadsSublevel, levelKeys } from "@main/level";
import { getDownloadFolderPath } from "@main/helpers/find-game-installer";
import type { GameShop } from "@types";

const hasDownloadFolder = async (
  _event: Electron.IpcMainInvokeEvent,
  shop: GameShop,
  objectId: string
): Promise<boolean> => {
  const download = await downloadsSublevel.get(levelKeys.game(shop, objectId));
  const folderPath = download ? await getDownloadFolderPath(download) : null;

  if (!folderPath) return false;

  return fs.promises.access(folderPath).then(
    () => true,
    () => false
  );
};

registerEvent("hasDownloadFolder", hasDownloadFolder);
