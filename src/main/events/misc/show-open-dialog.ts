import { dialog } from "electron";
import { WindowManager } from "@main/services";
import { registerEvent } from "../register-event";

const showOpenDialog = async (
  _event: Electron.IpcMainInvokeEvent,
  options: Electron.OpenDialogOptions
) => {
  if (!WindowManager.mainWindow) {
    throw new Error("Unable to open a dialog without having a main window");
  }

  return await dialog.showOpenDialog(WindowManager.mainWindow, options);
};

registerEvent(showOpenDialog, {
  name: "showOpenDialog",
});
