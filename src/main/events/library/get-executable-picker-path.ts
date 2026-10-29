import fs from "node:fs";

import { registerEvent } from "../register-event";
import { downloadsSublevel, levelKeys } from "@main/level";
import { getDownloadFolderPath } from "@main/helpers/find-game-installer";
import { GameShop } from "@types";

const getExecutablePickerPath = async (
  _event: Electron.IpcMainInvokeEvent,
  shop: GameShop,
  objectId: string
): Promise<string | null> => {
  const download = await downloadsSublevel.get(levelKeys.game(shop, objectId));

  if (!download || download.installerLaunched) return null;

  const folderPath = await getDownloadFolderPath(download);
  if (!folderPath) return null;

  const stats = await fs.promises.stat(folderPath).catch(() => null);

  return stats?.isDirectory() ? folderPath : null;
};

registerEvent("getExecutablePickerPath", getExecutablePickerPath);
