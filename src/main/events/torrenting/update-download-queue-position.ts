import { registerEvent } from "../register-event";
import { downloadsSublevel } from "@main/level";
import {
  DownloadOrchestrator,
  getDownloadLayoutStateRecord,
  getQueuedDownloadsOrderedByLayout,
} from "@main/services";
import { getDownloadId, type GameShop } from "../../../types";

export const setDownloadQueuePositionInternal = async (
  shop: GameShop,
  objectId: string,
  targetIndex: number
) => {
  return DownloadOrchestrator.setQueuePosition(shop, objectId, targetIndex);
};

export const setPausedDownloadPositionInternal = async (
  shop: GameShop,
  objectId: string,
  targetIndex: number
) => {
  return DownloadOrchestrator.setPausedPosition(shop, objectId, targetIndex);
};

const updateDownloadQueuePosition = async (
  _event: Electron.IpcMainInvokeEvent,
  shop: GameShop,
  objectId: string,
  direction: "up" | "down"
) => {
  const allDownloads = await downloadsSublevel.values().all();
  const layoutState = await getDownloadLayoutStateRecord();
  const queuedDownloads = getQueuedDownloadsOrderedByLayout(
    allDownloads,
    layoutState
  );
  const downloadId = getDownloadId({ shop, objectId });
  const currentIndex = queuedDownloads.findIndex(
    (download) => getDownloadId(download) === downloadId
  );

  if (currentIndex === -1) {
    return false;
  }

  const targetIndex = direction === "up" ? currentIndex - 1 : currentIndex + 1;

  return setDownloadQueuePositionInternal(shop, objectId, targetIndex);
};

registerEvent("updateDownloadQueuePosition", updateDownloadQueuePosition);
