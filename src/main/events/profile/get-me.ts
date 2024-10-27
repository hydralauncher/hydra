import { registerEvent } from "../register-event";
import type { UserDetails } from "@types";
import { getUserData } from "@main/services/user/get-user-data";

const getMe = async (
  _event: Electron.IpcMainInvokeEvent
): Promise<UserDetails | null> => {
  return getUserData();
};

registerEvent("getMe", getMe);
