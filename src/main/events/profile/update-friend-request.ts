import { registerEvent } from "../register-event";
import { HydraApi } from "@main/services";
import { FriendRequestAction } from "@types";

const updateFriendRequest = async (
  _event: Electron.IpcMainInvokeEvent,
  userId: string,
  action: FriendRequestAction
) => {
  if (action == "CANCEL") {
    return HydraApi.delete(`/profile/friend-requests/${userId}`);
  }

  return HydraApi.patch(`/profile/friend-requests/${userId}`, {
    requestState: action,
  });
};

registerEvent("updateFriendRequest", updateFriendRequest);
