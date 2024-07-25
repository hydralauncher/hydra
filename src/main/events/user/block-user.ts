import { registerEvent } from "../register-event";
import { HydraApi } from "@main/services";

const blockUser = async (
  _event: Electron.IpcMainInvokeEvent,
  userId: string
): Promise<void> => {
  return HydraApi.get(`/user/${userId}/block`);
};

registerEvent("block", blockUser);
