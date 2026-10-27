import { levelKeys } from "@main/level";
import { DownloadManager } from "@main/services";
import type { GameShop } from "@types";
import { updateDownloadRecord } from "@main/services/download-record-updater";
import { registerEvent } from "../register-event";

const setDownloadBandwidthPriority = async (
  _event: Electron.IpcMainInvokeEvent,
  shop: GameShop,
  objectId: string,
  priority: "normal" | "high"
) => {
  if (priority !== "normal" && priority !== "high") {
    throw new Error("Invalid download bandwidth priority");
  }

  const key = levelKeys.game(shop, objectId);
  const download = await updateDownloadRecord(key, {
    bandwidthPriority: priority === "high" ? "high" : undefined,
  });
  if (!download) return false;
  await DownloadManager.rebalanceBandwidth(true);
  return true;
};

registerEvent("setDownloadBandwidthPriority", setDownloadBandwidthPriority);
