import type { ChatUnreadState, ChatUnreadSummary } from "@types";
import { HydraApi } from "../hydra-api";
import { logger } from "../logger";
import { WindowManager } from "../window-manager";
import { ChatTaskbarBadge } from "./chat-taskbar-badge";

export type ChatUnreadConversation = ChatUnreadSummary["conversations"][number];

// What changed in one conversation while an unread load was in flight. The
// load's response can predate it, so it is applied on top of the response.
interface PendingUnreadChange {
  /** The count a mark-read response reported. */
  unreadCount?: number;
  /** Creation times of the messages counted as unread after that. */
  incoming: string[];
}

// Unread counts for the sidebar and friends window badges. The server is
// authoritative: counts are loaded from /profile/chats/unread on startup,
// sign-in and reconnect, only nudged locally in between, and replaced by
// mark-read responses.
export class ChatUnreadStore {
  private static unread = new Map<string, number>();
  private static lastMessageAt = new Map<string, string>();
  private static readonly lastSeenSeq = new Map<string, number>();
  private static isLoaded = false;
  private static loading: Promise<void> | null = null;
  private static pendingChanges: Map<string, PendingUnreadChange> | null = null;
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
    createdAt: string,
    countAsUnread: boolean
  ) {
    if (seq <= (this.lastSeenSeq.get(friendId) ?? 0)) return false;
    this.lastSeenSeq.set(friendId, seq);

    if (!countAsUnread) return true;

    if (this.pendingChanges) {
      const change = this.pendingChanges.get(friendId) ?? { incoming: [] };
      change.incoming.push(createdAt);
      this.pendingChanges.set(friendId, change);
    }

    if (this.isLoaded) {
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

  /** Identifies the signed-in session; changes on sign-out. */
  public static getGeneration() {
    return this.generation;
  }

  /**
   * Applies a mark-read response. One from a request started before sign-out,
   * an earlier `generation`, is dropped: it belongs to the previous account.
   */
  public static setUnread(
    friendId: string,
    unreadCount: number,
    generation = this.generation
  ) {
    if (generation !== this.generation) return;

    this.pendingChanges?.set(friendId, { unreadCount, incoming: [] });

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
    this.pendingChanges = null;
    this.broadcast();
  }

  private static async load(generation: number) {
    const changes = new Map<string, PendingUnreadChange>();
    this.pendingChanges = changes;

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
      for (const [friendId, change] of changes) {
        this.applyPendingChange(friendId, change);
      }
      this.isLoaded = true;
      this.broadcast();
    } catch (error) {
      logger.error("Failed to load chat unread counts", error);
    } finally {
      if (this.pendingChanges === changes) this.pendingChanges = null;
    }
  }

  private static applyPendingChange(
    friendId: string,
    change: PendingUnreadChange
  ) {
    // Without a mark-read, the response already counts the messages up to its
    // newest one, so only later ones are missing from it.
    const countedUntil =
      change.unreadCount === undefined
        ? this.lastMessageAt.get(friendId)
        : undefined;
    const missing = countedUntil
      ? change.incoming.filter(
          (createdAt) => Date.parse(createdAt) > Date.parse(countedUntil)
        ).length
      : change.incoming.length;

    const unreadCount =
      (change.unreadCount ?? this.unread.get(friendId) ?? 0) + missing;
    if (unreadCount > 0) this.unread.set(friendId, unreadCount);
    else this.unread.delete(friendId);
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
