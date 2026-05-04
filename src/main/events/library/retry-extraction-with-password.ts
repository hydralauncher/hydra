import { registerEvent } from "../register-event";
import { GameShop } from "@types";
import { GameFilesManager } from "@main/services";

const retryExtractionWithPassword = async (
  _event: Electron.IpcMainInvokeEvent,
  shop: GameShop,
  objectId: string,
  password: string
) => {
  const gameFilesManager = new GameFilesManager(shop, objectId);
  await gameFilesManager.retryExtractionWithPassword(password);
};

registerEvent("retryExtractionWithPassword", retryExtractionWithPassword);
