import { registerEvent } from "../register-event";
import { GameShop } from "@types";
import { Ludusavi } from "@main/services";

const checkGameCloudSyncSupport = async (
  _event: Electron.IpcMainInvokeEvent,
  objectId: string,
  shop: GameShop
) => {
  const games = await Ludusavi.findGames(shop, objectId);
  return games.length === 1;
};

registerEvent("checkGameCloudSyncSupport", checkGameCloudSyncSupport);
