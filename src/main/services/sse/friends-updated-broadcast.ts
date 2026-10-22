import { WindowManager } from "@main/services/window-manager";
import { createFriendsUpdateThrottle } from "./friends-update-throttle";

export const broadcastFriendsUpdated = createFriendsUpdateThrottle(() =>
  WindowManager.sendToAppWindows("on-friends-updated")
);
