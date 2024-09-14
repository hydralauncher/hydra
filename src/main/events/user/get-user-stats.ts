import { registerEvent } from "../register-event";
import { HydraApi } from "@main/services";
import type { UserStats } from "@types";

export const getUserStats = async (
  _event: Electron.IpcMainInvokeEvent,
  userId: string
): Promise<UserStats> => {
  return HydraApi.get(`/users/${userId}/stats`);
};

registerEvent("getUserStats", getUserStats);
