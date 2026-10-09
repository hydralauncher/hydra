import type { ChatUnreadState, ChatUnreadSummary } from "@types";
import { HydraApi } from "../hydra-api";
import { logger } from "../logger";
import { WindowManager } from "../window-manager";
import { ChatTaskbarBadge } from "./chat-taskbar-badge";

export type ChatUnreadConversation = ChatUnreadSummary["conversations"][number];

// Unread counts for the sidebar and friends window badges. The server is
// authoritative: counts are loaded from /profile/chats/unread on startup,
// sign-in and reconnect, only nudged locally in between, and replaced by
// mark-read responses.
export class ChatUnreadStore {
  private static unread = new Map<string, number>();
  private static lastMessageAt = new Map<string, string>();
  private static lastSeenSeq = new Map<string, number>();
  private static isLoaded = false;
  private static loading: Promise<void> | null = null;
  // Bumped on clear() so a load started before sign-out can't repopulate the
  // store with the previous user's counts.
  private static generation = 0;

  public static async getState(): Promise<ChatUnreadState> {
    if (!this.isLoaded) await this.refresh();
    return this.toState();
  }

  public static refresh(): Promise<void> {
    if (!HydraApi.isLoggedIn()) return Promise.resolve();

    this.loading ??= this.load(this.generation).finally(() => {
      this.loading = null;
    });

    return this.loading;
  }

  /** Returns false for a seq already seen, so duplicate deliveries are ignored. */
  public static registerIncoming(
    friendId: string,
    seq: number,
    countAsUnread: boolean
  ) {
    if (seq <= (this.lastSeenSeq.get(friendId) ?? 0)) return false;
    this.lastSeenSeq.set(friendId, seq);

    if (countAsUnread && this.isLoaded) {
      this.unread.set(friendId, (this.unread.get(friendId) ?? 0) + 1);
      this.broadcast();
    }

    return true;
  }

  public static getUnreadConversations(): ChatUnreadConversation[] {
    return [...this.unread.entries()].map(([friendId, unreadCount]) => ({
      friendId,
      unreadCount,
      lastMessageAt: this.lastMessageAt.get(friendId) ?? "",
    }));
  }

  public static setUnread(friendId: string, unreadCount: number) {
    if (unreadCount > 0) this.unread.set(friendId, unreadCount);
    else this.unread.delete(friendId);
    this.broadcast();
  }

  public static clear() {
    this.generation++;
    this.unread.clear();
    this.lastMessageAt.clear();
    this.lastSeenSeq.clear();
    this.isLoaded = false;
    this.loading = null;
    this.broadcast();
  }

  private static async load(generation: number) {
    try {
      const summary = await HydraApi.get<ChatUnreadSummary>(
        "/profile/chats/unread"
      );
      if (generation !== this.generation) return;

      this.unread = new Map(
        summary.conversations.map((conversation) => [
          conversation.friendId,
          conversation.unreadCount,
        ])
      );
      this.lastMessageAt = new Map(
        summary.conversations.map((conversation) => [
          conversation.friendId,
          conversation.lastMessageAt,
        ])
      );
      this.isLoaded = true;
      this.broadcast();
    } catch (error) {
      logger.error("Failed to load chat unread counts", error);
    }
  }

  private static toState(): ChatUnreadState {
    let totalUnread = 0;
    for (const count of this.unread.values()) totalUnread += count;

    return { totalUnread, byFriend: Object.fromEntries(this.unread) };
  }

  private static broadcast() {
    const state = this.toState();
    WindowManager.sendToAppWindows("on-chat-unread-updated", state);
    void ChatTaskbarBadge.setCount(state.totalUnread);
  }
}
