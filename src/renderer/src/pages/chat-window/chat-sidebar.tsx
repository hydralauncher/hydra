import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import { useTranslation } from "react-i18next";
import { PlusIcon, SearchIcon, XIcon } from "@primer/octicons-react";
import cn from "classnames";

import type { UserFriend } from "@types";

import { ChatFriendAvatar, ChatFriendStatus } from "./chat-friend-status";
import { ChatNewConversationPanel } from "./chat-new-conversation";
import { ChatOfficialBadge } from "./chat-official-badge";
import {
  CHAT_SIDEBAR_INITIAL_WIDTH,
  CHAT_SIDEBAR_WIDTH_STORAGE_KEY,
  clampChatSidebarWidth,
  filterConversations,
  getAdjacentConversationId,
  getConversationPreview,
  getLatestMessage,
  isOfficialAccount,
  sortConversationsByActivity,
} from "./chat-sidebar-layout";
import type { ChatConversation } from "./chat-types";

const readStoredWidth = () => {
  const stored = Number(localStorage.getItem(CHAT_SIDEBAR_WIDTH_STORAGE_KEY));
  return stored > 0
    ? clampChatSidebarWidth(stored)
    : CHAT_SIDEBAR_INITIAL_WIDTH;
};

const DAY_MS = 24 * 60 * 60 * 1000;
/** Messages newer than this show a weekday instead of a date. */
const WEEKDAY_LABEL_DAYS = 7;

/** How long a row takes to glide to its new place after a reorder. */
const ROW_MOVE_MS = 320;
const ROW_MOVE_EASING = "cubic-bezier(0.22, 1, 0.36, 1)";

const prefersReducedMotion = () =>
  window.matchMedia("(prefers-reduced-motion: reduce)").matches;

/** Where a row currently is, visually, relative to its layout position. */
const getTranslateY = (element: HTMLElement) => {
  const { transform } = getComputedStyle(element);
  if (!transform || transform === "none") return 0;
  return new DOMMatrixReadOnly(transform).m42;
};

/**
 * Glides rows into place when the list reorders (FLIP): each row that moved
 * starts from where it was and transitions to where it is now. Measured with
 * `offsetTop`, so scrolling the list between renders doesn't count as a move.
 * A row moved again mid-glide continues from where it visually is, and
 * rerenders (typing dots, message status) never cut a glide short.
 */
function useRowReorderAnimation(rows: Map<string, HTMLElement>) {
  const lastTops = useRef(new Map<string, number>());
  const settleTimers = useRef(new Map<HTMLElement, number>());

  useEffect(() => {
    const timers = settleTimers.current;
    return () => {
      for (const timer of timers.values()) window.clearTimeout(timer);
    };
  }, []);

  useLayoutEffect(() => {
    const previous = lastTops.current;
    const next = new Map<string, number>();
    const moved: { element: HTMLElement; delta: number }[] = [];

    for (const [id, element] of rows) {
      const top = element.offsetTop;
      next.set(id, top);
      const before = previous.get(id);
      if (before !== undefined && before !== top) {
        moved.push({ element, delta: before - top + getTranslateY(element) });
      }
    }
    lastTops.current = next;

    if (moved.length === 0 || prefersReducedMotion()) return;

    for (const { element, delta } of moved) {
      element.style.transition = "none";
      element.style.transform = `translateY(${delta}px)`;
    }
    // Paints the rows at their old place before they start moving.
    void document.body.offsetHeight;

    requestAnimationFrame(() => {
      for (const { element } of moved) {
        element.style.transition = `transform ${ROW_MOVE_MS}ms ${ROW_MOVE_EASING}`;
        element.style.transform = "";
      }
    });

    for (const { element } of moved) {
      window.clearTimeout(settleTimers.current.get(element));
      settleTimers.current.set(
        element,
        window.setTimeout(() => {
          element.style.transition = "";
          settleTimers.current.delete(element);
        }, ROW_MOVE_MS)
      );
    }
  });
}

/** "14:32" today, a weekday within the week, else a short date. */
function usePreviewTime() {
  const { t, i18n } = useTranslation("chat_window");

  return (iso: string | undefined): string | null => {
    if (!iso) return null;
    const date = new Date(iso);
    if (Number.isNaN(date.getTime())) return null;

    const now = new Date();
    const startOfToday = new Date(
      now.getFullYear(),
      now.getMonth(),
      now.getDate()
    ).getTime();
    const daysAgo = Math.floor((startOfToday - date.getTime()) / DAY_MS) + 1;

    if (date.getTime() >= startOfToday) {
      return date.toLocaleTimeString(i18n.language, {
        hour: "2-digit",
        minute: "2-digit",
      });
    }
    if (daysAgo === 1) return t("yesterday");
    if (daysAgo < WEEKDAY_LABEL_DAYS) {
      return date.toLocaleDateString(i18n.language, { weekday: "short" });
    }
    return date.toLocaleDateString(i18n.language, {
      day: "numeric",
      month: "short",
    });
  };
}

interface ChatSidebarRowProps {
  conversation: ChatConversation;
  isActive: boolean;
  rowRef: (element: HTMLDivElement | null) => void;
  onSelect: () => void;
}

function ChatSidebarRow({
  conversation,
  isActive,
  rowRef,
  onSelect,
}: Readonly<ChatSidebarRowProps>) {
  const { t } = useTranslation("chat_window");
  const formatTime = usePreviewTime();
  const { friend, isTyping, unreadCount } = conversation;
  const isOfficial = isOfficialAccount(friend);

  const hasUnread = !isActive && unreadCount > 0;
  const preview = getConversationPreview(conversation);
  const time = formatTime(getLatestMessage(conversation)?.createdAt);

  const renderPreview = () => {
    if (isTyping) return <ChatFriendStatus friend={friend} isTyping />;
    if (!preview) {
      // The official account is neither online nor offline.
      if (isOfficial) {
        return (
          <span className="chat-window__sidebar-preview">
            {t("official_subtitle")}
          </span>
        );
      }
      return <ChatFriendStatus friend={friend} />;
    }

    const prefix =
      preview.kind !== "removed" && preview.fromMe ? `${t("you")}: ` : "";

    switch (preview.kind) {
      case "text":
        return (
          <span className="chat-window__sidebar-preview">
            {prefix}
            {preview.text}
          </span>
        );
      case "images":
        return (
          <span className="chat-window__sidebar-preview">
            {prefix}
            {t("quoted_images", { count: preview.count })}
          </span>
        );
      case "removed":
        return (
          <span className="chat-window__sidebar-preview chat-window__sidebar-preview--removed">
            {t("message_removed")}
          </span>
        );
    }
  };

  return (
    <div
      ref={rowRef}
      className={cn("chat-window__sidebar-row", {
        "chat-window__sidebar-row--active": isActive,
        "chat-window__sidebar-row--unread": hasUnread,
      })}
    >
      <button
        type="button"
        className="chat-window__sidebar-row-button"
        onClick={onSelect}
        aria-label={
          isOfficial
            ? `${friend.displayName} · ${t("official_account")}`
            : friend.displayName
        }
        aria-current={isActive ? "true" : undefined}
      >
        <ChatFriendAvatar friend={friend} size={40} />
        <span className="chat-window__sidebar-row-details">
          <span className="chat-window__sidebar-row-top">
            <span className="chat-window__sidebar-row-name">
              <span className="chat-window__sidebar-row-name-text">
                {friend.displayName}
              </span>
              {isOfficial && <ChatOfficialBadge size={14} />}
            </span>
            {time && (
              <span className="chat-window__sidebar-row-time">{time}</span>
            )}
          </span>
          <span className="chat-window__sidebar-row-bottom">
            {renderPreview()}
            {hasUnread && (
              <span
                className="chat-window__unread-badge"
                aria-label={t("unread_count", { count: unreadCount })}
              >
                {unreadCount}
              </span>
            )}
          </span>
        </span>
      </button>
    </div>
  );
}

export interface ChatSidebarProps {
  conversations: ChatConversation[];
  activeId: string | null;
  onSelect: (friendId: string) => void;
  /** Friends the new conversation panel offers. */
  friends: UserFriend[];
  onRefreshFriends: () => void;
  onOpenConversation: (friend: UserFriend) => void;
}

/**
 * The conversation list on the left, WhatsApp-style: searchable and
 * resizable within the main sidebar's limits.
 */
export function ChatSidebar({
  conversations,
  activeId,
  onSelect,
  friends,
  onRefreshFriends,
  onOpenConversation,
}: Readonly<ChatSidebarProps>) {
  const { t } = useTranslation("chat_window");

  const [width, setWidth] = useState(readStoredWidth);
  const [windowWidth, setWindowWidth] = useState(() => window.innerWidth);
  const displayedWidth = clampChatSidebarWidth(width, windowWidth);
  const [isResizing, setIsResizing] = useState(false);
  const [query, setQuery] = useState("");
  const [isPickerOpen, setIsPickerOpen] = useState(false);

  const searchRef = useRef<HTMLInputElement>(null);
  const rowRefs = useRef(new Map<string, HTMLElement>());
  useRowReorderAnimation(rowRefs.current);
  // The width at the last move is read back on release, which may land in
  // the same frame as the move, before React rerenders.
  const resizeRef = useRef<{
    pointerId: number;
    startX: number;
    startWidth: number;
    width: number;
  } | null>(null);

  const openPicker = useCallback(() => {
    setIsPickerOpen(true);
    onRefreshFriends();
  }, [onRefreshFriends]);

  const closePicker = useCallback(() => setIsPickerOpen(false), []);

  const togglePicker = useCallback(() => {
    if (isPickerOpen) closePicker();
    else openPicker();
  }, [isPickerOpen, openPicker, closePicker]);

  // Like browser tabs: Ctrl+Tab and Ctrl+Shift+Tab cycle through every
  // conversation, filtered-out ones included. Ctrl+T starts a new one.
  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.altKey || event.metaKey || !event.ctrlKey) return;

      if (event.key === "Tab") {
        // Switching would unmount an open dialog and lose what was typed.
        if (document.querySelector("[data-hydra-dialog]")) return;

        event.preventDefault();
        const nextId = getAdjacentConversationId(
          sortConversationsByActivity(conversations).map(
            (conversation) => conversation.friend.id
          ),
          activeId,
          event.shiftKey ? -1 : 1
        );
        if (nextId) onSelect(nextId);
        return;
      }

      if (!event.shiftKey && event.key.toLowerCase() === "t") {
        event.preventDefault();
        togglePicker();
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [conversations, activeId, onSelect, togglePicker]);

  useEffect(() => {
    const updateWindowWidth = () => setWindowWidth(window.innerWidth);
    window.addEventListener("resize", updateWindowWidth);
    return () => window.removeEventListener("resize", updateWindowWidth);
  }, []);

  const handleResizeStart = (event: React.PointerEvent<HTMLButtonElement>) => {
    if (event.button !== 0) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    resizeRef.current = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startWidth: displayedWidth,
      width: displayedWidth,
    };
    setIsResizing(true);
  };

  const handleResizeMove = (event: React.PointerEvent<HTMLButtonElement>) => {
    const resize = resizeRef.current;
    if (!resize || resize.pointerId !== event.pointerId) return;

    const next = clampChatSidebarWidth(
      resize.startWidth + event.clientX - resize.startX,
      window.innerWidth
    );
    resize.width = next;
    setWidth(next);
  };

  const handleResizeEnd = (event: React.PointerEvent<HTMLButtonElement>) => {
    const resize = resizeRef.current;
    if (!resize || resize.pointerId !== event.pointerId) return;

    resizeRef.current = null;
    setIsResizing(false);
    localStorage.setItem(CHAT_SIDEBAR_WIDTH_STORAGE_KEY, String(resize.width));
  };

  const pickFriend = (friend: UserFriend) => {
    onOpenConversation(friend);
    closePicker();
  };

  const visibleConversations = filterConversations(
    sortConversationsByActivity(conversations),
    query
  );

  const renderRows = () =>
    visibleConversations.map((conversation) => (
      <ChatSidebarRow
        key={conversation.friend.id}
        conversation={conversation}
        isActive={conversation.friend.id === activeId}
        rowRef={(element) => {
          if (element) rowRefs.current.set(conversation.friend.id, element);
          else rowRefs.current.delete(conversation.friend.id);
        }}
        onSelect={() => onSelect(conversation.friend.id)}
      />
    ));

  const newConversationButton = (
    <button
      type="button"
      className={cn("chat-window__new-conversation-button", {
        "chat-window__new-conversation-button--open": isPickerOpen,
      })}
      onClick={togglePicker}
      title={t("new_conversation_shortcut")}
      aria-label={t("new_conversation")}
      aria-expanded={isPickerOpen}
    >
      <PlusIcon size={14} />
    </button>
  );

  return (
    <aside
      className={cn("chat-window__sidebar", {
        "chat-window__sidebar--resizing": isResizing,
      })}
      style={{ width: displayedWidth }}
      aria-label={t("conversations")}
    >
      {isPickerOpen ? (
        <ChatNewConversationPanel
          friends={friends}
          openFriendIds={
            new Set(conversations.map((conversation) => conversation.friend.id))
          }
          onPick={pickFriend}
          onClose={closePicker}
        />
      ) : (
        <>
          <div className="chat-window__sidebar-header">
            <div className="chat-window__sidebar-heading">
              <h1 className="chat-window__sidebar-title">{t("chats")}</h1>
              <span
                className="chat-window__sidebar-count"
                aria-label={t("open_conversations_count", {
                  count: conversations.length,
                })}
              >
                {conversations.length}
              </span>
            </div>
            {newConversationButton}
          </div>

          <label className="chat-window__emoji-search chat-window__sidebar-search">
            <SearchIcon size={14} className="chat-window__emoji-search-icon" />
            <input
              ref={searchRef}
              type="text"
              className="chat-window__emoji-search-input"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder={t("search_conversations")}
              aria-label={t("search_conversations")}
              onKeyDown={(event) => {
                if (event.key === "Escape" && query) {
                  event.preventDefault();
                  setQuery("");
                }
              }}
            />
            {query && (
              <button
                type="button"
                className="chat-window__emoji-search-clear"
                onClick={() => {
                  setQuery("");
                  searchRef.current?.focus();
                }}
                aria-label={t("emoji_clear_search")}
              >
                <XIcon size={12} />
              </button>
            )}
          </label>

          <nav
            className="chat-window__sidebar-list"
            aria-label={t("conversations")}
          >
            {renderRows()}
            {visibleConversations.length === 0 && conversations.length > 0 && (
              <p className="chat-window__sidebar-empty">
                {t("no_conversations_match", { query: query.trim() })}
              </p>
            )}
          </nav>

          <button
            type="button"
            className="chat-window__sidebar-handle"
            aria-label={t("resize_sidebar")}
            title={t("resize_sidebar")}
            onPointerDown={handleResizeStart}
            onPointerMove={handleResizeMove}
            onPointerUp={handleResizeEnd}
            onPointerCancel={handleResizeEnd}
            onLostPointerCapture={handleResizeEnd}
          />
        </>
      )}
    </aside>
  );
}
