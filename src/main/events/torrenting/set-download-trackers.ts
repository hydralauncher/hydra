import { downloadsSublevel, levelKeys } from "@main/level";
import { registerEvent } from "../register-event";
import { PythonRPC } from "@main/services/python-rpc";
import type { GameShop } from "@types";

const setDownloadTrackers = async (
  _event: Electron.IpcMainInvokeEvent,
  shop: GameShop,
  objectId: string,
  trackers: string[]
) => {
  const downloadKey = levelKeys.game(shop, objectId);
  const download = await downloadsSublevel.get(downloadKey);

  if (!download) return;

  await downloadsSublevel.put(downloadKey, {
    ...download,
    customTrackers: trackers,
  });

  PythonRPC.rpc
    .call("action", {
      action: "set_trackers",
      game_id: downloadKey,
      trackers,
    })
    .catch(() => {});
};

registerEvent("setDownloadTrackers", setDownloadTrackers);
