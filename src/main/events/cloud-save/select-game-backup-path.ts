import { registerEvent } from "../register-event";
import type { GameShop } from "@types";
import { Ludusavi } from "@main/services";

const selectGameBackupPath = async (
  _event: Electron.IpcMainInvokeEvent,
  _shop: GameShop,
  objectId: string,
  backupPath: string | null
) => {
  return Ludusavi.addCustomGame(objectId, backupPath);
};

registerEvent("selectGameBackupPath", selectGameBackupPath);
