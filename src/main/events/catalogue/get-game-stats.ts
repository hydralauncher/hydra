import type { GameShop } from "@types";

import { registerEvent } from "../register-event";
import { HydraApi } from "@main/services";
import type { GameStats } from "@types";

const getGameStats = async (
  _event: Electron.IpcMainInvokeEvent,
  objectId: string,
  shop: GameShop
) => {
  return HydraApi.get<GameStats>(
    `/games/stats`,
    { objectId, shop },
    { needsAuth: false }
  );
};

registerEvent("getGameStats", getGameStats);
