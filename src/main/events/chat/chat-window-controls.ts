import { WindowManager } from "@main/services";
import { ipcMain } from "electron";

ipcMain.handle("minimizeChatWindow", () => {
  WindowManager.minimizeChatWindow();
});

ipcMain.handle("closeChatWindow", () => {
  WindowManager.closeChatWindow();
});
