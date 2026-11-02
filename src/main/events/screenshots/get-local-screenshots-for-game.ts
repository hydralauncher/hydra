import type { GameShop } from "@types";
import { getLocalScreenshotsForGame } from "@main/services/screenshots";
import { registerEvent } from "../register-event";

registerEvent(
  "getLocalScreenshotsForGame",
  (_event: Electron.IpcMainInvokeEvent, shop: GameShop, objectId: string) =>
    getLocalScreenshotsForGame(shop, objectId)
);
