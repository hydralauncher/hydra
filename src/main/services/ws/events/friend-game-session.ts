import type { FriendGameSession } from "@main/generated/envelope";
import { db, levelKeys } from "@main/level";
import { HydraApi } from "@main/services/hydra-api";
import { publishFriendStartedPlayingGameNotification } from "@main/services/notifications";
import type { GameStats, UserPreferences, UserProfile } from "@types";

export const friendGameSessionEvent = async (payload: FriendGameSession) => {
  const userPreferences = await db.get<string, UserPreferences | null>(
    levelKeys.userPreferences,
    {
      valueEncoding: "json",
    }
  );

  if (userPreferences?.friendStartGameNotificationsEnabled === false) return;

  const [friend, gameStats] = await Promise.all([
    HydraApi.get<UserProfile>(`/users/${payload.friendId}`),
    HydraApi.get<GameStats>(`/games/steam/${payload.objectId}/stats`),
  ]).catch(() => [null, null]);

  if (friend && gameStats) {
    publishFriendStartedPlayingGameNotification(friend, gameStats);
  }
};
