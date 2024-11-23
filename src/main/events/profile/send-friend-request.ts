import { registerEvent } from "../register-event";
import { HydraApi } from "@main/services";

const sendFriendRequest = async (
  _event: Electron.IpcMainInvokeEvent,
  userId: string
) => {
  return HydraApi.post("/profile/friend-requests", { friendCode: userId });
};

registerEvent("sendFriendRequest", sendFriendRequest);
