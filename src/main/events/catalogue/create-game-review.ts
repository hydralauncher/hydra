import { registerEvent } from "../register-event";
import { HydraApi } from "@main/services";
import type { GameShop } from "@types";

const createGameReview = async (
  _event: Electron.IpcMainInvokeEvent,
  shop: GameShop,
  objectId: string,
  reviewHtml: string,
  score: number
) => {
  return HydraApi.post(`/games/${shop}/${objectId}/reviews`, {
    reviewHtml,
    score,
  });
};

registerEvent("createGameReview", createGameReview);
