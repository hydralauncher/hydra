import { WindowManager } from "@main/services";
import { ipcMain } from "electron";

ipcMain.handle("openFriendProfileInMainWindow", (_event, userId: string) => {
  WindowManager.focusMainWindowAndNavigate(`/profile/${userId}`);
});
