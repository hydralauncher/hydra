import { registerEvent } from "../register-event";
import { GameShop } from "@types";
import { downloadsSublevel, gamesSublevel, levelKeys } from "@main/level";

const setDownloadManualOrder = async (
  _event: Electron.IpcMainInvokeEvent,
  shop: GameShop,
  objectIdFrom: string,
  objectIdTo: string,
  manualOrderFrom: number,
  manualOrderTo: number,
): Promise<boolean> => {
  const gameKeyFrom = levelKeys.game(shop, objectIdFrom);
  const gameKeyTo = levelKeys.game(shop, objectIdTo);

  const [downloadFrom, gameFrom] = await Promise.all([
    downloadsSublevel.get(gameKeyFrom),
    gamesSublevel.get(gameKeyFrom),
  ]);

  const [downloadTo, gameTo] = await Promise.all([
    downloadsSublevel.get(gameKeyTo),
    gamesSublevel.get(gameKeyTo),
  ]);

  if (!downloadFrom || !gameFrom || !downloadTo || !gameTo) return false;

  if(manualOrderTo === manualOrderFrom){
    manualOrderTo--
  }

  await downloadsSublevel.put(gameKeyFrom, {
    ...downloadFrom,
    manualOrder: manualOrderTo 
  });

  await downloadsSublevel.put(gameKeyTo, {
    ...downloadTo,
    manualOrder: manualOrderFrom 
  });

  return true;
};

registerEvent("setDownloadManualOrder", setDownloadManualOrder);
