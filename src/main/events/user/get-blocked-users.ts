import { registerEvent } from "../register-event";
import { HydraApi } from "@main/services";
import { UserNotLoggedInError } from "@shared";
import type { UserBlocks } from "@types";

export const getBlockedUsers = async (
  _event: Electron.IpcMainInvokeEvent,
  take: number,
  skip: number
): Promise<UserBlocks> => {
  return HydraApi.get(`/profile/blocks`, { take, skip }).catch((err) => {
    if (err instanceof UserNotLoggedInError) {
      return { blocks: [] };
    }
    throw err;
  });
};

registerEvent("getBlockedUsers", getBlockedUsers);
