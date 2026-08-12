import { DiskUsage } from "@types";
import { registerEvent } from "../register-event";
import { getDiskUsage } from "@main/services/disk-usage";

const getDiskFreeSpace = async (
  _event: Electron.IpcMainInvokeEvent,
  path: string
): Promise<DiskUsage | null> => {
  return getDiskUsage(path);
};

registerEvent("getDiskFreeSpace", getDiskFreeSpace);
