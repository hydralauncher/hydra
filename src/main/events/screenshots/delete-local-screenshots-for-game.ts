import type { GameShop } from "@types";
import { deleteLocalScreenshotsForGame } from "@main/services/screenshots";
import { registerEvent } from "../register-event";

registerEvent(
  "deleteLocalScreenshotsForGame",
  (_event: Electron.IpcMainInvokeEvent, shop: GameShop, objectId: string) =>
    deleteLocalScreenshotsForGame(shop, objectId)
);
