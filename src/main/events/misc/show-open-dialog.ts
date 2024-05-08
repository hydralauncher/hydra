import { WindowManager } from "@main/services";
import { dialog } from "electron";
import { registerEvent } from "../register-event";

const showOpenDialog = (
  _event: Electron.IpcMainInvokeEvent,
  options: Electron.OpenDialogOptions
) => {
  if (WindowManager.mainWindow) {
    return dialog.showOpenDialog(WindowManager.mainWindow, options);
  }
};

registerEvent(showOpenDialog, {
  name: "showOpenDialog",
});
