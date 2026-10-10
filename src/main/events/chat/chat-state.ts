import { HydraApi, WindowManager } from "@main/services";
import { ChatUnreadStore } from "@main/services/chat/chat-unread-store";
import { logger } from "@main/services/logger";
import type { ChatWindowState } from "@types";
import { ipcMain } from "electron";

// Friend ids are interpolated into an API path, so only hashids get through.
const FRIEND_ID_PATTERN = /^[A-Za-z0-9]{8}$/;

const isFriendId = (value: unknown): value is string =>
  typeof value === "string" && FRIEND_ID_PATTERN.test(value);

ipcMain.handle("setChatWindowState", (_event, state: ChatWindowState) => {
  WindowManager.setChatWindowState({
    activeFriendId: isFriendId(state?.activeFriendId)
      ? state.activeFriendId
      : null,
    openFriendIds: Array.isArray(state?.openFriendIds)
      ? state.openFriendIds.filter(isFriendId)
      : [],
  });
});

ipcMain.handle("getChatUnreadState", () => ChatUnreadStore.getState());

ipcMain.handle(
  "markChatRead",
  async (_event, friendId: string, seq: number): Promise<boolean> => {
    if (!isFriendId(friendId) || !Number.isSafeInteger(seq) || seq < 0) {
      return false;
    }

    const generation = ChatUnreadStore.getGeneration();

    try {
      const { unreadCount } = await HydraApi.post<{ unreadCount: number }>(
        `/profile/chats/${friendId}/read`,
        { seq }
      );
      ChatUnreadStore.setUnread(friendId, unreadCount, generation);
      return true;
    } catch (error) {
      logger.error("Failed to mark chat as read", error);
      return false;
    }
  }
);
