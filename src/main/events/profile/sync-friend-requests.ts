import { registerEvent } from "../register-event";
import { HydraApi } from "@main/services";
import { UserNotLoggedInError } from "@shared";
import type { FriendRequestSync } from "@types";

const syncFriendRequests = async (_event: Electron.IpcMainInvokeEvent) => {
  return HydraApi.get<FriendRequestSync>(`/profile/friend-requests/sync`).catch(
    (err) => {
      if (err instanceof UserNotLoggedInError) {
        return { friendRequests: [] };
      }
      throw err;
    }
  );
};

registerEvent("syncFriendRequests", syncFriendRequests);
