import { WindowManager } from "@main/services";
import { ipcMain } from "electron";

ipcMain.handle("openFriendsWindow", () => {
  void WindowManager.openFriendsWindow();
});
