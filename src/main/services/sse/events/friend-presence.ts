import type { FriendPresence } from "../types";
import { WindowManager } from "@main/services/window-manager";

export const friendPresenceEvent = (
  payload: FriendPresence,
  signal: AbortSignal
) => {
  if (signal.aborted) return;
  // Broadcast to every window (the friends window has its own renderer/store).
  WindowManager.sendToAppWindows("on-friend-presence", {
    friendId: payload.friendId,
    isOnline: payload.isOnline,
  });
};
