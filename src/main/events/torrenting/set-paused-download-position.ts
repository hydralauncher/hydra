import { registerEvent } from "../register-event";
import type { GameShop } from "@types";
import { setPausedDownloadPositionInternal } from "./update-download-queue-position";

const setPausedDownloadPosition = async (
  _event: Electron.IpcMainInvokeEvent,
  shop: GameShop,
  objectId: string,
  targetIndex: number
) => {
  return setPausedDownloadPositionInternal(shop, objectId, targetIndex);
};

registerEvent("setPausedDownloadPosition", setPausedDownloadPosition);
