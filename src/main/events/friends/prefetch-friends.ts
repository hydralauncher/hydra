import { FriendsSnapshotCache } from "@main/services";
import { ipcMain } from "electron";

// Fired when the profile menu opens, so the list is usually cached by the time
// the user clicks "Friends".
ipcMain.handle("prefetchFriends", () => {
  void FriendsSnapshotCache.prefetch();
});

ipcMain.handle("getFriendsSnapshot", () => FriendsSnapshotCache.get());
