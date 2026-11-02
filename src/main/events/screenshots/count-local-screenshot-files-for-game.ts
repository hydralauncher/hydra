import type { GameShop } from "@types";
import { countLocalScreenshotFilesForGame } from "@main/services/screenshots";
import { registerEvent } from "../register-event";

registerEvent(
  "countLocalScreenshotFilesForGame",
  (_event: Electron.IpcMainInvokeEvent, shop: GameShop, objectId: string) =>
    countLocalScreenshotFilesForGame(shop, objectId)
);
