import { dialog } from "electron";
import { WindowManager } from "@main/services";
import { registerEvent } from "../register-event";

const showSaveDialog = async (
  _event: Electron.IpcMainInvokeEvent,
  options: Electron.SaveDialogOptions
) => {
  if (WindowManager.mainWindow) {
    return dialog.showSaveDialog(WindowManager.mainWindow, options);
  }

  throw new Error("Main window is not available");
};

registerEvent("showSaveDialog", showSaveDialog);
