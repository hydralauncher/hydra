import { registerEvent } from "../register-event";
import { HydraApi, WindowManager } from "@main/services";
import { UserNotLoggedInError } from "@shared";
import type { FriendRequestSync } from "@types";

export const syncFriendRequests = async () => {
  return HydraApi.get<FriendRequestSync>(`/profile/friend-requests/sync`)
    .then((res) => {
      WindowManager.mainWindow?.webContents.send(
        "on-sync-friend-requests",
        res
      );

      return res;
    })
    .catch((err) => {
      if (err instanceof UserNotLoggedInError) {
        return { friendRequestCount: 0 } as FriendRequestSync;
      }
      throw err;
    });
};

registerEvent("syncFriendRequests", syncFriendRequests);
