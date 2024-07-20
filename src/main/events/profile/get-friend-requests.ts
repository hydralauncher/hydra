import { registerEvent } from "../register-event";
import { HydraApi } from "@main/services";
import { FriendRequest } from "@types";

const getFriendRequests = async (
  _event: Electron.IpcMainInvokeEvent
): Promise<FriendRequest[]> => {
  return HydraApi.get(`/profile/friend-requests`).catch(() => []);
};

registerEvent("getFriendRequests", getFriendRequests);
