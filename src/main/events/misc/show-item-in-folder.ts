import { shell } from "electron";
import { registerEvent } from "../register-event";

const showItemInFolder = async (
  _event: Electron.IpcMainInvokeEvent,
  filePath: string
) => {
  return shell.showItemInFolder(filePath);
};

registerEvent("showItemInFolder", showItemInFolder);
