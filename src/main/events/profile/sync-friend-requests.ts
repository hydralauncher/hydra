import { MAIN_LOOP_INTERVAL } from "@main/constants";
import { registerEvent } from "../register-event";
import { HydraApi, WindowManager } from "@main/services";
import { publishNewFriendRequestNotification } from "@main/services/notifications";
import { UserNotLoggedInError } from "@shared";
import type { FriendRequestSync } from "@types";

interface SyncState {
  friendRequestCount: number | null;
  tick: number;
}

const ticksToUpdate = (2 * 60 * 1000) / MAIN_LOOP_INTERVAL; // 2 minutes

const syncState: SyncState = {
  friendRequestCount: null,
  tick: 0,
};

const syncFriendRequests = async () => {
  return HydraApi.get<FriendRequestSync>(`/profile/friend-requests/sync`)
    .then((res) => {
      if (
        syncState.friendRequestCount != null &&
        syncState.friendRequestCount < res.friendRequestCount
      ) {
        publishNewFriendRequestNotification();
      }

      syncState.friendRequestCount = res.friendRequestCount;

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

const syncFriendRequestsEvent = async (_event: Electron.IpcMainInvokeEvent) => {
  return syncFriendRequests();
};

export const watchFriendRequests = async () => {
  if (syncState.tick % ticksToUpdate === 0) {
    await syncFriendRequests();
  }

  syncState.tick++;
};

registerEvent("syncFriendRequests", syncFriendRequestsEvent);
