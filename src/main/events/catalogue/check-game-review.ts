import { registerEvent } from "../register-event";
import { HydraApi } from "@main/services";
import type { GameShop } from "@types";

const checkGameReview = async (
  _event: Electron.IpcMainInvokeEvent,
  shop: GameShop,
  objectId: string
) => {
  return HydraApi.get(`/games/${shop}/${objectId}/reviews/check`, null, {
    needsAuth: true,
  });
};

registerEvent("checkGameReview", checkGameReview);
