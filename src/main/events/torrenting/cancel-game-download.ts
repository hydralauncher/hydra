import { registerEvent } from "../register-event";
import { DownloadOrchestrator, GameFilesManager, logger } from "@main/services";
import type { GameShop } from "@types";

const cancelGameDownload = async (
  _event: Electron.IpcMainInvokeEvent,
  shop: GameShop,
  objectId: string
) => {
  logger.log(`[Downloads] Cancel requested for ${shop}:${objectId}`);
  GameFilesManager.cancelPs4Extraction(shop, objectId);
  return DownloadOrchestrator.cancelDownloadById(shop, objectId);
};

registerEvent("cancelGameDownload", cancelGameDownload);
