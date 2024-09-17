import { registerEvent } from "../register-event";
import { HydraApi } from "@main/services";
import { FriendRequestSync } from "@types";

const syncFriendRequests = async (_event: Electron.IpcMainInvokeEvent) => {
  return HydraApi.get<FriendRequestSync>(`/profile/friend-requests/sync`);
};

registerEvent("syncFriendRequests", syncFriendRequests);
