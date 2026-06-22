import { stat } from "node:fs/promises";
import { registerEvent } from "../register-event";

export interface PathInfo {
  exists: boolean;
  isDirectory: boolean;
  isFile: boolean;
}

const getPathInfo = async (
  _event: Electron.IpcMainInvokeEvent,
  filePath: string
): Promise<PathInfo> => {
  try {
    const stats = await stat(filePath);
    return {
      exists: true,
      isDirectory: stats.isDirectory(),
      isFile: stats.isFile(),
    };
  } catch {
    return {
      exists: false,
      isDirectory: false,
      isFile: false,
    };
  }
};

registerEvent("getPathInfo", getPathInfo);
