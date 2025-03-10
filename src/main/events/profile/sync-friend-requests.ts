import { registerEvent } from "../register-event";
import { HydraApi } from "@main/services";
import { publishNewFriendRequestNotification } from "@main/services/notifications";
import { UserNotLoggedInError } from "@shared";
import type { FriendRequestSync } from "@types";

interface SyncState {
  friendsRequest: number | null;
}

const syncState: SyncState = {
  friendsRequest: null,
};

const syncFriendRequests = async (_event: Electron.IpcMainInvokeEvent) => {
  return HydraApi.get<FriendRequestSync>(`/profile/friend-requests/sync`)
    .then((res) => {
      if (
        syncState.friendsRequest != null &&
        syncState.friendsRequest < res.friendRequestCount
      ) {
        publishNewFriendRequestNotification();
      }

      syncState.friendsRequest = res.friendRequestCount;

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
