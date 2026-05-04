import type { FriendGameSession } from "@main/generated/envelope";
import { db, levelKeys } from "@main/level";
import { HydraApi } from "@main/services/hydra-api";
import { publishFriendStartedPlayingGameNotification } from "@main/services/notifications";
import { WindowManager } from "@main/services/window-manager";
import type {
  FriendNotificationInfo,
  UserPreferences,
  UserProfile,
} from "@types";

export const friendGameSessionEvent = async (payload: FriendGameSession) => {
  const userPreferences = await db.get<string, UserPreferences | null>(
    levelKeys.userPreferences,
    {
      valueEncoding: "json",
    }
  );

  if (userPreferences?.friendStartGameNotificationsEnabled === false) return;

  const friend = await HydraApi.get<UserProfile>(`/users/${payload.friendId}`);

  if (friend) {
    if (userPreferences?.friendStartGameCustomNotificationsEnabled !== false) {
      const friendInfo: FriendNotificationInfo = {
        displayName: friend.displayName,
        profileImageUrl: friend.profileImageUrl,
        gameTitle: friend.currentGame?.title ?? "",
        gameIconUrl: friend.currentGame?.iconUrl ?? null,
      };

      WindowManager.notificationWindow?.webContents.send(
        "on-friend-started-playing",
        userPreferences?.achievementCustomNotificationPosition ?? "top-left",
        friendInfo
      );
    } else {
      publishFriendStartedPlayingGameNotification(friend);
    }
  }
};
