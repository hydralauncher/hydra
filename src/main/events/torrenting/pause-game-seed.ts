import { downloadsSublevel } from "@main/level";
import { levelKeys } from "@main/level";
import { registerEvent } from "../register-event";
import { DownloadManager } from "@main/services";
import type { GameShop } from "@types";

const pauseGameSeed = async (
  _event: Electron.IpcMainInvokeEvent,
  shop: GameShop,
  objectId: string
) => {
  const downloadKey = levelKeys.game(shop, objectId);
  const download = await downloadsSublevel.get(downloadKey);

  if (!download) return;

  await downloadsSublevel.put(downloadKey, {
    ...download,
    shouldSeed: false,
  });

  await DownloadManager.pauseSeeding(downloadKey);
};

registerEvent("pauseGameSeed", pauseGameSeed);
