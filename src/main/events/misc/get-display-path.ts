import { PathGrants } from "@main/services";
import { registerEvent } from "../register-event";

const getDisplayPath = async (
  _event: Electron.IpcMainInvokeEvent,
  accessPath: string
) => {
  return PathGrants.getDisplayPath(accessPath);
};

registerEvent("getDisplayPath", getDisplayPath);
