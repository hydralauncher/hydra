import { registerEvent } from "../register-event";
import { HydraApi } from "@main/services";
import type { GameShop } from "@types";

const voteReview = async (
  _event: Electron.IpcMainInvokeEvent,
  shop: GameShop,
  objectId: string,
  reviewId: string,
  voteType: "upvote" | "downvote"
) => {
  return HydraApi.put(
    `/games/${shop}/${objectId}/reviews/${reviewId}/${voteType}`,
    {}
  );
};

registerEvent("voteReview", voteReview);
