import type { FriendRequest } from "@main/generated/envelope";
import { HydraApi } from "@main/services/hydra-api";
import { publishNewFriendRequestNotification } from "@main/services/notifications";
import { WindowManager } from "@main/services/window-manager";

export const friendRequestEvent = async (payload: FriendRequest) => {
  WindowManager.mainWindow?.webContents.send("on-sync-friend-requests", {
    friendRequestCount: payload.friendRequestCount,
  });

  const user = await HydraApi.get(`/users/${payload.senderId}`);

  if (user) {
    publishNewFriendRequestNotification(user);
  }
};
