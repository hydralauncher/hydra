import fs from "node:fs";

import { registerEvent } from "../register-event";
import { downloadsSublevel, levelKeys } from "@main/level";
import { getSourceArchivePath } from "@main/helpers/find-game-installer";
import type { GameShop } from "@types";

const hasSourceArchive = async (
  _event: Electron.IpcMainInvokeEvent,
  shop: GameShop,
  objectId: string
): Promise<boolean> => {
  const download = await downloadsSublevel.get(levelKeys.game(shop, objectId));
  const archivePath = download ? await getSourceArchivePath(download) : null;

  if (!archivePath) return false;

  const stats = await fs.promises.stat(archivePath).catch(() => null);
  return stats?.isFile() ?? false;
};

registerEvent("hasSourceArchive", hasSourceArchive);
