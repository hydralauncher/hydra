import { registerEvent } from "../register-event";
import { DownloadOrchestrator, logger } from "@main/services";
import type { GameShop } from "@types";

const cancelGameDownload = async (
  _event: Electron.IpcMainInvokeEvent,
  shop: GameShop,
  objectId: string
) => {
  logger.log(`[Downloads] Cancel requested for ${shop}:${objectId}`);
  return DownloadOrchestrator.cancelDownloadById(shop, objectId);
};

registerEvent("cancelGameDownload", cancelGameDownload);
