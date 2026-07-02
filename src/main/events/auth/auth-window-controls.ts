import { WindowManager } from "@main/services";
import { ipcMain } from "electron";

ipcMain.handle("minimizeAuthWindow", () => {
  WindowManager.minimizeAuthWindow();
});

ipcMain.handle("closeAuthWindow", () => {
  WindowManager.closeAuthWindow();
});
