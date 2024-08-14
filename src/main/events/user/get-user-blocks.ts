import { registerEvent } from "../register-event";
import { HydraApi } from "@main/services";
import { UserBlocks } from "@types";

export const getUserBlocks = async (
  _event: Electron.IpcMainInvokeEvent,
  take: number,
  skip: number
): Promise<UserBlocks> => {
  return HydraApi.get(`/profile/blocks`, { take, skip });
};

registerEvent("getUserBlocks", getUserBlocks);
