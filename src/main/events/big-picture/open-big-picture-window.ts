import { WindowManager } from "@main/services";
import { ipcMain } from "electron";

ipcMain.handle("openBigPictureWindow", () => {
  WindowManager.openBigPictureWindow();
});
