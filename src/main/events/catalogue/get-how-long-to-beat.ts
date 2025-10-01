import type { GameShop, HowLongToBeatCategory } from "@types";

import { registerEvent } from "../register-event";
import { HydraApi } from "@main/services";

const getHowLongToBeat = async (
  _event: Electron.IpcMainInvokeEvent,
  objectId: string,
  shop: GameShop
): Promise<HowLongToBeatCategory[] | null> => {
  return HydraApi.get(`/games/${shop}/${objectId}/how-long-to-beat`, null, {
    needsAuth: false,
  });
};

registerEvent("getHowLongToBeat", getHowLongToBeat);
