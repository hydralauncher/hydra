import { registerEvent } from "../register-event";
import type { GameShop } from "@types";
import { setDownloadQueuePositionInternal } from "./update-download-queue-position";

const setDownloadQueuePosition = async (
  _event: Electron.IpcMainInvokeEvent,
  shop: GameShop,
  objectId: string,
  targetIndex: number
) => {
  return setDownloadQueuePositionInternal(shop, objectId, targetIndex);
};

registerEvent("setDownloadQueuePosition", setDownloadQueuePosition);
