import { registerEvent } from "../register-event";
import { DownloadOrchestrator, logger } from "@main/services";
import type { GameShop } from "@types";

const resumeGameDownload = async (
  _event: Electron.IpcMainInvokeEvent,
  shop: GameShop,
  objectId: string,
  strategy: "interruptActive" | "queueIfActive" = "interruptActive"
) => {
  logger.log(
    `[Downloads] Resume requested for ${shop}:${objectId} (strategy=${strategy})`
  );

  return DownloadOrchestrator.resumeDownload(shop, objectId, strategy);
};

registerEvent("resumeGameDownload", resumeGameDownload);
