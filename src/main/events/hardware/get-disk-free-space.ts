import { DiskUsage } from "@types";
import { registerEvent } from "../register-event";
import checkDiskSpace from "check-disk-space";

const getDiskFreeSpace = async (
  _event: Electron.IpcMainInvokeEvent,
  path: string
): Promise<DiskUsage> => {
  const result = await checkDiskSpace(path);
  return { free: result.free, total: result.size };
};

registerEvent("getDiskFreeSpace", getDiskFreeSpace);
