import type { GameShop } from "@types";

import { registerEvent } from "../register-event";
import { HydraApi } from "@main/services";
import type { GameStats } from "@types";

const getGameStats = async (
  _event: Electron.IpcMainInvokeEvent,
  objectId: string,
  shop: GameShop
) => {
  const response = await HydraApi.get<GameStats>(
    `/games/stats`,
    { objectId, shop },
    { needsAuth: false }
  );
  return response;
};

registerEvent("getGameStats", getGameStats);
