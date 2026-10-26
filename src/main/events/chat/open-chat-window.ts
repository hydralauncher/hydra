import { WindowManager } from "@main/services";
import type { UserFriend } from "@types";
import { ipcMain } from "electron";

ipcMain.handle("openChatWindow", (_event, friend: UserFriend) => {
  void WindowManager.openChatWindow(friend);
});

ipcMain.handle("consumePendingChatFriends", () =>
  WindowManager.consumePendingChatFriends()
);
