import { WindowManager } from "@main/services";
import { ipcMain } from "electron";

// Friend-request mutations (accept/refuse/cancel/send) go straight through the
// HTTP API from whichever renderer the user is in. The WS push only reaches the
// *other* user, so the acting user's own windows never learn the request was
// handled. This lets the acting renderer fan the change out to every app window
// (main, big picture, friends) so notification lists and badges stay in sync.
ipcMain.handle("syncFriendRequests", (_event, friendRequestCount: number) => {
  WindowManager.sendToAppWindows("on-sync-friend-requests", {
    friendRequestCount,
  });
});
