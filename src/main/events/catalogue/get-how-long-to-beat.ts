import type { GameShop, HowLongToBeatCategory } from "@types";
import { HydraApi } from "@main/services";

import { registerEvent } from "../register-event";

const getHowLongToBeat = async (
  _event: Electron.IpcMainInvokeEvent,
  shop: GameShop,
  objectId: string
): Promise<HowLongToBeatCategory[] | null> => {
  const params = new URLSearchParams({
    shop,
    objectId: objectId.toString(),
  });

  return HydraApi.get(`/games/how-long-to-beat?${params.toString()}`, null, {
    needsAuth: false,
  });
};

registerEvent("getHowLongToBeat", getHowLongToBeat);
