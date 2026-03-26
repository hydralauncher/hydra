import { WebDavBackup, CloudSync } from "@main/services";
import type { GameShop } from "@types";
import { registerEvent } from "../register-event";

const uploadSaveGameToWebDav = async (
  _event: Electron.IpcMainInvokeEvent,
  objectId: string,
  shop: GameShop,
  downloadOptionTitle: string | null
) => {
  return WebDavBackup.uploadSaveGame(
    objectId,
    shop,
    downloadOptionTitle,
    CloudSync.getBackupLabel(false)
  );
};

registerEvent("uploadSaveGameToWebDav", uploadSaveGameToWebDav);
