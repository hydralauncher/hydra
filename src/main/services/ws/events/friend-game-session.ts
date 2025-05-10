import type { FriendGameSession } from "@main/generated/envelope";
import { HydraApi } from "@main/services/hydra-api";
import { publishFriendStartedPlayingGameNotification } from "@main/services/notifications";
import { GameStats } from "@types";

export const friendGameSessionEvent = async (payload: FriendGameSession) => {
  const [friend, gameStats] = await Promise.all([
    HydraApi.get(`/users/${payload.friendId}`),
    HydraApi.get<GameStats>(
      `/games/stats?objectId=${payload.objectId}&shop=steam`
    ),
  ]);

  if (friend && gameStats) {
    publishFriendStartedPlayingGameNotification(friend, gameStats);
  }
};
