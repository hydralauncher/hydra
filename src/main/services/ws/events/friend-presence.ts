import type { FriendPresence } from "@main/generated/envelope";
import { WindowManager } from "@main/services/window-manager";

export const friendPresenceEvent = (payload: FriendPresence) => {
  // Broadcast to every window (the friends window has its own renderer/store).
  WindowManager.sendToAppWindows("on-friend-presence", {
    friendId: payload.friendId,
    isOnline: payload.isOnline,
  });
};
