import { registerEvent } from "../register-event";
import { HydraApi } from "@main/services";
import type { UserProfile } from "@types";

const getUser = async (
  _event: Electron.IpcMainInvokeEvent,
  userId: string
): Promise<UserProfile | null> => {
  return HydraApi.get<UserProfile>(`/users/${userId}`).catch(() => null);
};

registerEvent("getUser", getUser);
