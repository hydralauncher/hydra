import { registerEvent } from "../register-event";
import { HydraApi } from "@main/services";

const unblockUser = async (
  _event: Electron.IpcMainInvokeEvent,
  userId: string
) => {
  await HydraApi.post(`/users/${userId}/unblock`);
};

registerEvent("unblockUser", unblockUser);
