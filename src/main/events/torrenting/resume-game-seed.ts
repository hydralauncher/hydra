import { downloadsSublevel, levelKeys } from "@main/level";
import { registerEvent } from "../register-event";
import { DownloadManager } from "@main/services";
import type { GameShop } from "@types";

const resumeGameSeed = async (
  _event: Electron.IpcMainInvokeEvent,
  shop: GameShop,
  objectId: string
) => {
  const download = await downloadsSublevel.get(levelKeys.game(shop, objectId));

  if (!download) return;

  await downloadsSublevel.put(levelKeys.game(shop, objectId), {
    ...download,
    status: "seeding",
    shouldSeed: true,
  });

  await DownloadManager.resumeSeeding(download);
};

registerEvent("resumeGameSeed", resumeGameSeed);
