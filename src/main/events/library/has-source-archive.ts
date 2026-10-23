import { registerEvent } from "../register-event";
import { downloadsSublevel, levelKeys } from "@main/level";
import { findSourceArchiveFile } from "@main/helpers/find-game-installer";
import type { GameShop } from "@types";

const hasSourceArchive = async (
  _event: Electron.IpcMainInvokeEvent,
  shop: GameShop,
  objectId: string
): Promise<boolean> => {
  const download = await downloadsSublevel.get(levelKeys.game(shop, objectId));
  if (!download) return false;

  return (await findSourceArchiveFile(download)) !== null;
};

registerEvent("hasSourceArchive", hasSourceArchive);
