import { registerEvent } from "../register-event";
import { HydraApi } from "@main/services";

const unblockUser = async (
  _event: Electron.IpcMainInvokeEvent,
  userId: string
): Promise<void> => {
  return HydraApi.post(`/user/${userId}/unblock`);
};

registerEvent("unblockUser", unblockUser);
