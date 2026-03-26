import { WebDavBackup } from "@main/services";
import type { GameShop } from "@types";
import { registerEvent } from "../register-event";

const renameWebDavBackup = async (
  _event: Electron.IpcMainInvokeEvent,
  objectId: string,
  shop: GameShop,
  href: string,
  label: string
) => {
  return WebDavBackup.renameBackup(objectId, shop, href, label);
};

registerEvent("renameWebDavBackup", renameWebDavBackup);
