import { registerEvent } from "../register-event";
import { DownloadOrchestrator } from "@main/services";
import type { GameShop } from "@types";

const pauseGameDownload = async (
  _event: Electron.IpcMainInvokeEvent,
  shop: GameShop,
  objectId: string
) => {
  return DownloadOrchestrator.pauseDownloadById(shop, objectId);
};

registerEvent("pauseGameDownload", pauseGameDownload);
