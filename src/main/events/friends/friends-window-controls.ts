import { WindowManager } from "@main/services";
import { ipcMain } from "electron";

ipcMain.handle("minimizeFriendsWindow", () => {
  WindowManager.minimizeFriendsWindow();
});

ipcMain.handle("closeFriendsWindow", () => {
  WindowManager.closeFriendsWindow();
});
