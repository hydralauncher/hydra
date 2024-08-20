import { registerEvent } from "../register-event";
import { HydraApi } from "@main/services";

const blockUser = async (
  _event: Electron.IpcMainInvokeEvent,
  userId: string
) => {
  await HydraApi.post(`/users/${userId}/block`);
};

registerEvent("blockUser", blockUser);
