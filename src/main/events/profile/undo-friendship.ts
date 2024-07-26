import { registerEvent } from "../register-event";
import { HydraApi } from "@main/services";

const undoFriendship = async (
  _event: Electron.IpcMainInvokeEvent,
  userId: string
): Promise<void> => {
  return HydraApi.delete(`/profile/friends/${userId}`);
};

registerEvent("undoFriendship", undoFriendship);
