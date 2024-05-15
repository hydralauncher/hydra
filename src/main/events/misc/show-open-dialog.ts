import { dialog } from "electron";
import { WindowManager } from "@main/services";
import { registerEvent } from "../register-event";

const showOpenDialog = async (
  _event: Electron.IpcMainInvokeEvent,
  options: Electron.OpenDialogOptions
) => {
  if (WindowManager.mainWindow) {
    return dialog.showOpenDialog(WindowManager.mainWindow, options);
  }

  throw new Error("Main window is not available");
};

registerEvent("showOpenDialog", showOpenDialog);
