import { WindowManager } from "@main/services";
import { ipcMain } from "electron";

ipcMain.handle("openAddFriendModalInMainWindow", () => {
  WindowManager.openAddFriendModalInMainWindow();
});
