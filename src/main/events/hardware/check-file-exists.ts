import fs from "node:fs";

import { registerEvent } from "../register-event";

const checkFileExists = async (
  _event: Electron.IpcMainInvokeEvent,
  filePath: string
): Promise<boolean> => {
  if (!filePath) return false;
  try {
    return fs.existsSync(filePath);
  } catch {
    return false;
  }
};

registerEvent("checkFileExists", checkFileExists);
