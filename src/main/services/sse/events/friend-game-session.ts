import type { FriendGameSession } from "../types";
import { db, levelKeys } from "@main/level";
import { WindowManager } from "@main/services/window-manager";
import { publishFriendStartedPlayingGameNotification } from "@main/services/notifications";
import type { UserPreferences } from "@types";
import { toFriendGameSessionNotification } from "../friend-game-session-notification";
import { createFriendsUpdateThrottle } from "../friends-update-throttle";

const broadcastFriendsUpdated = createFriendsUpdateThrottle(() =>
  WindowManager.sendToAppWindows("on-friends-updated")
);

export const cancelFriendsUpdatedBroadcast = () =>
  broadcastFriendsUpdated.cancel();

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
