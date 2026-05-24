import { BrowserWindow, dialog } from "electron";
import { WindowManager } from "@main/services";
import { registerEvent } from "../register-event";

const showOpenDialog = async (
  event: Electron.IpcMainInvokeEvent,
  options: Electron.OpenDialogOptions
) => {
  const senderWindow = BrowserWindow.fromWebContents(event.sender);

  if (senderWindow && !senderWindow.isDestroyed()) {
    return dialog.showOpenDialog(senderWindow, options);
  }

  if (WindowManager.mainWindow) {
    return dialog.showOpenDialog(WindowManager.mainWindow, options);
  }

  throw new Error("Main window is not available");
};

registerEvent("showOpenDialog", showOpenDialog);
