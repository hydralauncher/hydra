import type { FriendGameSession } from "../types";
import { db, levelKeys } from "@main/level";
import { HydraApi } from "@main/services/hydra-api";
import { WindowManager } from "@main/services/window-manager";
import { publishFriendStartedPlayingGameNotification } from "@main/services/notifications";
import type { UserPreferences, UserProfile } from "@types";

export const friendGameSessionEvent = async (payload: FriendGameSession) => {
  WindowManager.sendToAppWindows("on-friends-updated");

  const userPreferences = await db.get<string, UserPreferences | null>(
    levelKeys.userPreferences,
    {
      valueEncoding: "json",
    }
  );

  if (userPreferences?.friendStartGameNotificationsEnabled === false) return;

  const friend = await HydraApi.get<UserProfile>(`/users/${payload.friendId}`, {
    shop: payload.shop,
  });

  if (friend) {
    publishFriendStartedPlayingGameNotification(friend);
  }
};
