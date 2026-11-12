import type { GameShop } from "@types";
import { getPublishedScreenshotIdsForGame } from "@main/services/screenshots";
import { registerEvent } from "../register-event";

registerEvent(
  "getPublishedScreenshotIdsForGame",
  (_event: Electron.IpcMainInvokeEvent, shop: GameShop, objectId: string) =>
    getPublishedScreenshotIdsForGame(shop, objectId)
);
