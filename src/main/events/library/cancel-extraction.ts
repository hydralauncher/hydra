import { registerEvent } from "../register-event";
import { GameShop } from "@types";
import { downloadsSublevel, levelKeys } from "@main/level";
import { WindowManager } from "@main/services";

const cancelExtraction = async (
  _event: Electron.IpcMainInvokeEvent,
  shop: GameShop,
  objectId: string
) => {
  const gameKey = levelKeys.game(shop, objectId);
  const download = await downloadsSublevel.get(gameKey);

  if (!download) return;

  await downloadsSublevel.put(gameKey, {
    ...download,
    extracting: false,
    extractionProgress: 0,
  });

  WindowManager.mainWindow?.webContents.send(
    "on-extraction-complete",
    shop,
    objectId
  );
};

registerEvent("cancelExtraction", cancelExtraction);
