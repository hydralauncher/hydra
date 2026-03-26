import { WebDavBackup } from "@main/services";
import type { GameShop } from "@types";
import { registerEvent } from "../register-event";

const downloadWebDavBackup = async (
  _event: Electron.IpcMainInvokeEvent,
  objectId: string,
  shop: GameShop,
  href: string
) => {
  return WebDavBackup.downloadAndRestoreBackup(objectId, shop, href);
};

registerEvent("downloadWebDavBackup", downloadWebDavBackup);
