import { WebDavBackup } from "@main/services";
import type { GameShop } from "@types";
import { registerEvent } from "../register-event";

const listWebDavBackups = async (
  _event: Electron.IpcMainInvokeEvent,
  objectId: string,
  shop: GameShop
) => {
  return WebDavBackup.listBackups(objectId, shop);
};

registerEvent("listWebDavBackups", listWebDavBackups);
