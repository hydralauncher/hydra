import { WindowManager } from "@main/services";
import { ipcMain } from "electron";

ipcMain.handle("minimizeMainWindow", () => {
  WindowManager.minimizeMainWindow();
});

ipcMain.handle("toggleMaximizeMainWindow", () => {
  WindowManager.toggleMaximizeMainWindow();
});

ipcMain.handle("closeMainWindow", () => {
  WindowManager.closeMainWindow();
});

ipcMain.handle("isMainWindowMaximized", () =>
  WindowManager.isMainWindowMaximized()
);
