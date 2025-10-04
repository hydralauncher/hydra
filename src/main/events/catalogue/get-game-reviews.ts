import { registerEvent } from "../register-event";
import { HydraApi } from "@main/services";
import type { GameShop } from "@types";

const getGameReviews = async (
  _event: Electron.IpcMainInvokeEvent,
  shop: GameShop,
  objectId: string,
  take: number = 20,
  skip: number = 0,
  sortBy: string = "newest"
) => {
  const params = new URLSearchParams({
    take: take.toString(),
    skip: skip.toString(),
    sortBy,
  });

  return HydraApi.get(
    `/games/${shop}/${objectId}/reviews?${params.toString()}`,
    null,
    { needsAuth: false }
  );
};

registerEvent("getGameReviews", getGameReviews);
