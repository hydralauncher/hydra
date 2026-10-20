import type { FriendGameSession } from "../types";
import { db, levelKeys } from "@main/level";
import { publishFriendStartedPlayingGameNotification } from "@main/services/notifications";
import type { UserPreferences } from "@types";
import { toFriendGameSessionNotification } from "../friend-game-session-notification";
import { broadcastFriendsUpdated } from "../friends-updated-broadcast";

export const friendGameSessionEvent = async (
  payload: FriendGameSession,
  signal: AbortSignal
) => {
  if (signal.aborted) return;
  broadcastFriendsUpdated();

  const notification = toFriendGameSessionNotification(payload);
  if (!notification) return;

  const userPreferences = await db.get<string, UserPreferences | null>(
    levelKeys.userPreferences,
    {
      valueEncoding: "json",
    }
  );

  if (signal.aborted) return;
  if (userPreferences?.friendStartGameNotificationsEnabled === false) return;

  await publishFriendStartedPlayingGameNotification(notification, signal);
};
