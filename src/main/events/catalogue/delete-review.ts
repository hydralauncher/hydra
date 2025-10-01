import { registerEvent } from "../register-event";
import { HydraApi } from "@main/services";
import type { GameShop } from "@types";

const deleteReview = async (
  _event: Electron.IpcMainInvokeEvent,
  shop: GameShop,
  objectId: string,
  reviewId: string
) => {
  return HydraApi.delete(`/games/${shop}/${objectId}/reviews/${reviewId}`);
};

registerEvent("deleteReview", deleteReview);