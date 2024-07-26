import { registerEvent } from "../register-event";
import { HydraApi } from "@main/services";

const blockUser = async (
  _event: Electron.IpcMainInvokeEvent,
  userId: string
): Promise<void> => {
  return HydraApi.post(`/user/${userId}/block`);
};

registerEvent("blockUser", blockUser);
