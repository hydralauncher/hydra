import { registerEvent } from "../register-event";
import { HydraApi } from "@main/services";

export const reportUser = async (
  _event: Electron.IpcMainInvokeEvent,
  userId: string,
  reason: string,
  description: string
): Promise<void> => {
  return HydraApi.post(`/users/${userId}/report`, {
    reason,
    description,
  });
};

registerEvent("reportUser", reportUser);
