import { shell } from "electron";
import { ensureDirectorySync } from "@main/services/download/ensure-directory";
import { registerEvent } from "../register-event";

const openFolder = (
  _event: Electron.IpcMainInvokeEvent,
  folderPath: string
) => {
  ensureDirectorySync(folderPath);

  return shell.openPath(folderPath);
};

registerEvent("openFolder", openFolder);
