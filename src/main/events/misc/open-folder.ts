import { shell } from "electron";
import { registerEvent } from "../register-event";

const openFolder = async (
  _event: Electron.IpcMainInvokeEvent,
  folderPath: string
) => {
  return shell.openPath(folderPath);
};

registerEvent("openFolder", openFolder);