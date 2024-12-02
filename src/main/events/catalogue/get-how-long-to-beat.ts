import type { GameShop, HowLongToBeatCategory } from "@types";

import { registerEvent } from "../register-event";
import { HydraApi } from "@main/services";

const getHowLongToBeat = async (
  _event: Electron.IpcMainInvokeEvent,
  objectId: string,
  shop: GameShop
): Promise<HowLongToBeatCategory[] | null> => {
  const params = new URLSearchParams({
    objectId,
    shop,
  });

  return HydraApi.get(`/games/how-long-to-beat?${params.toString()}`, null, {
    needsAuth: false,
  });
};

registerEvent("getHowLongToBeat", getHowLongToBeat);
