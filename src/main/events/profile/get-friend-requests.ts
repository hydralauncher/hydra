import { registerEvent } from "../register-event";
import { HydraApi } from "@main/services";
import { PendingFriendRequest } from "@types";

const getFriendRequests = async (
  _event: Electron.IpcMainInvokeEvent
): Promise<PendingFriendRequest[] | null> => {
  try {
    const response = await HydraApi.get(`/profile/friend-requests`);
    return response.data;
  } catch (err) {
    return null;
  }
};

registerEvent("getFriendRequests", getFriendRequests);
