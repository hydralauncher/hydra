import { registerEvent } from "../register-event";
import { DownloadOrchestrator } from "@main/services";
import { DownloadManager } from "@main/services/download/download-manager";
import { levelKeys } from "@main/level";
import type { GameShop } from "@types";

const pauseGameDownload = async (
  _event: Electron.IpcMainInvokeEvent,
  shop: GameShop,
  objectId: string,
  confirmed = false
) => {
  return DownloadOrchestrator.pauseDownloadById(shop, objectId, confirmed);
};

registerEvent("pauseGameDownload", pauseGameDownload);
registerEvent(
  "getDownloadPauseWarning",
  (_event: Electron.IpcMainInvokeEvent, shop: GameShop, objectId: string) =>
    DownloadManager.requiresPauseConfirmation(levelKeys.game(shop, objectId))
);
