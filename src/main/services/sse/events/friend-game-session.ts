import type { FriendGameSession } from "../types";
import { db, levelKeys } from "@main/level";
import { HydraApi } from "@main/services/hydra-api";
import { WindowManager } from "@main/services/window-manager";
import { publishFriendStartedPlayingGameNotification } from "@main/services/notifications";
import type { UserPreferences, UserProfile } from "@types";

export const friendGameSessionEvent = async (
  payload: FriendGameSession,
  signal: AbortSignal
) => {
  if (signal.aborted) return;
  WindowManager.sendToAppWindows("on-friends-updated");

  const userPreferences = await db.get<string, UserPreferences | null>(
    levelKeys.userPreferences,
    {
      valueEncoding: "json",
    }
  );

  if (signal.aborted) return;
  if (userPreferences?.friendStartGameNotificationsEnabled === false) return;

  const friend = await HydraApi.get<UserProfile>(
    `/users/${payload.friendId}`,
    { shop: payload.shop },
    { signal }
  );

  if (friend && !signal.aborted) {
    await publishFriendStartedPlayingGameNotification(friend, signal);
  }
};
