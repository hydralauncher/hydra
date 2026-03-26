import { WebDavBackup } from "@main/services";
import type { GameShop } from "@types";
import { registerEvent } from "../register-event";

const deleteWebDavBackup = async (
  _event: Electron.IpcMainInvokeEvent,
  objectId: string,
  shop: GameShop,
  href: string
) => {
  return WebDavBackup.deleteBackup(objectId, shop, href);
};

registerEvent("deleteWebDavBackup", deleteWebDavBackup);
