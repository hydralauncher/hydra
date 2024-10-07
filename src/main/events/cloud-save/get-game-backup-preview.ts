import { registerEvent } from "../register-event";
import { GameShop } from "@types";
import { Ludusavi } from "@main/services";
import path from "node:path";
import { backupsPath } from "@main/constants";

const getGameBackupPreview = async (
  _event: Electron.IpcMainInvokeEvent,
  objectId: string,
  shop: GameShop
) => {
  const backupPath = path.join(backupsPath, `${shop}-${objectId}`);

  return Ludusavi.getBackupPreview(shop, objectId, backupPath);
};

registerEvent("getGameBackupPreview", getGameBackupPreview);
