import { dialog } from "electron";
import { WindowManager } from "@main/services";
import { registerEvent } from "../register-event";

const showOpenDialog = async (
  _event: Electron.IpcMainInvokeEvent,
  options: Electron.OpenDialogOptions
) => {
  if (WindowManager.mainWindow) {
    return await dialog.showOpenDialog(WindowManager.mainWindow, options);
  }
  return undefined;
};

registerEvent(showOpenDialog, {
  name: "showOpenDialog",
});
