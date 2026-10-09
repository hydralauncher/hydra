import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import { useTranslation } from "react-i18next";
import { ChevronDownIcon, DashIcon, XIcon } from "@primer/octicons-react";
import cn from "classnames";

import {
  ChatFriendAvatar,
  ChatFriendStatus,
  ChatTypingDots,
} from "./chat-friend-status";
import {
  clampDragOffset,
  getDragTargetIndex,
  getDropOffset,
  getTabShift,
  moveItem,
  type TabSlot,
} from "./chat-tab-drag";
import {
  CHAT_TAB_COMPACT_WIDTH,
  CHAT_TAB_GAP,
  getChatTabLayout,
} from "./chat-tab-layout";
import type { ChatConversation } from "./chat-types";
import { useDismiss } from "./use-dismiss";

const FRIEND_CARD_WIDTH = 240;
/** Tab area width at the default window size, until the first measurement. */
const DEFAULT_TABS_WIDTH = 468;

/** Pointer travel before a press on a tab becomes a drag. */
const DRAG_THRESHOLD = 4;
/** Time the dropped tab takes to glide into its slot. */
const SETTLE_MS = 150;

interface TabDrag {
  id: string;
  pointerId: number;
  startX: number;
  offset: number;
  started: boolean;
  dropping: boolean;
  fromIndex: number;
  toIndex: number;
  slots: TabSlot[];
}

interface ChatTabProps {
  conversation: ChatConversation;
  isActive: boolean;
  isCompact: boolean;
  width: number;
  isLastTab: boolean;
  alignCardToEnd: boolean;
  dragStyle?: React.CSSProperties;
  tabRef: (element: HTMLDivElement | null) => void;
  onPointerDown: (event: React.PointerEvent<HTMLDivElement>) => void;
  onPointerMove: (event: React.PointerEvent<HTMLDivElement>) => void;
  onPointerUp: (event: React.PointerEvent<HTMLDivElement>) => void;
  onSelect: () => void;
  onClose: () => void;
}

function ChatTab({
  conversation,
  isActive,
  isCompact,
  width,
  isLastTab,
  alignCardToEnd,
  dragStyle,
  tabRef,
  onPointerDown,
  onPointerMove,
  onPointerUp,
  onSelect,
  onClose,
}: ChatTabProps) {
  const { t } = useTranslation("chat_window");
  const { friend, isTyping, unreadCount } = conversation;

  const hasUnread = !isActive && unreadCount > 0;

  // Every tab has the same size and content whether or not it is active;
  // selecting one only recolors it.
  return (
    <div
      ref={tabRef}
      className={cn("chat-window__tab", {
        "chat-window__tab--active": isActive,
        "chat-window__tab--compact": isCompact,
        "chat-window__tab--unread": hasUnread,
      })}
      style={{ width, ...dragStyle }}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
      onLostPointerCapture={onPointerUp}
    >
      <button
        type="button"
        role="tab"
        aria-selected={isActive}
        aria-label={friend.displayName}
        className="chat-window__tab-button"
        onClick={onSelect}
        onAuxClick={(event) => {
          if (event.button === 1) onClose();
        }}
        title={isCompact ? undefined : friend.displayName}
      >
        <span className="chat-window__tab-avatar">
          {isTyping ? (
            <ChatTypingDots size="small" />
          ) : (
            <ChatFriendAvatar friend={friend} size={20} />
          )}
          {isCompact && hasUnread && (
            <span className="chat-window__tab-unread-dot" />
          )}
        </span>
        {!isCompact && (
          <span className="chat-window__tab-name">{friend.displayName}</span>
        )}
      </button>

      {/* The unread count shares the close button's slot until hovered. */}
      {!isCompact && (
        <span className="chat-window__tab-trailing">
          <button
            type="button"
            className="chat-window__tab-close chat-window__tab-action"
            onClick={onClose}
            title={isLastTab ? t("close_window") : t("close_conversation")}
            aria-label={
              isLastTab
                ? t("close_window")
                : t("close_conversation_with", { name: friend.displayName })
            }
          >
            <XIcon size={12} />
          </button>
          {hasUnread && (
            <span
              className="chat-window__unread-badge chat-window__tab-badge"
              aria-hidden="true"
            >
              {unreadCount}
            </span>
          )}
        </span>
      )}

      {isCompact && (
        <div
          className={cn("chat-window__friend-card", {
            "chat-window__friend-card--end": alignCardToEnd,
            "chat-window__friend-card--banner": friend.backgroundImageUrl,
          })}
          aria-hidden="true"
        >
          {friend.backgroundImageUrl && (
            <img
              className="chat-window__friend-card-banner"
              src={friend.backgroundImageUrl}
              alt=""
              loading="lazy"
            />
          )}
          <div className="chat-window__friend-card-content">
            <ChatFriendAvatar friend={friend} size={36} />
            <div className="chat-window__friend-card-details">
              <span className="chat-window__friend-card-name">
                {friend.displayName}
              </span>
              <ChatFriendStatus friend={friend} isTyping={isTyping} />
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export interface ChatTabStripProps {
  conversations: ChatConversation[];
  activeId: string | null;
  onSelect: (friendId: string) => void;
  onClose: (friendId: string) => void;
  /** New order of the tabs shown in the strip, after a drag. */
  onReorder: (visibleOrder: string[]) => void;
  onMinimize: () => void;
  onCloseWindow: () => void;
}

export function ChatTabStrip({
  conversations,
  activeId,
  onSelect,
  onClose,
  onReorder,
  onMinimize,
  onCloseWindow,
}: ChatTabStripProps) {
  const { t } = useTranslation("chat_window");

  const tabsAreaRef = useRef<HTMLDivElement>(null);
  const overflowRef = useRef<HTMLDivElement>(null);
  const [tabsWidth, setTabsWidth] = useState(DEFAULT_TABS_WIDTH);
  const [isMenuOpen, setIsMenuOpen] = useState(false);
  // Like Chrome, closing a tab keeps the widths until the pointer leaves the
  // strip, so the next close button lands under it.
  const [frozenTabWidth, setFrozenTabWidth] = useState<number | null>(null);

  const tabRefs = useRef(new Map<string, HTMLDivElement>());
  // The ref drives the pointer handlers; the state mirrors it for rendering.
  const dragRef = useRef<TabDrag | null>(null);
  const [drag, setDrag] = useState<TabDrag | null>(null);
  const settleTimerRef = useRef<number>();

  useEffect(() => () => window.clearTimeout(settleTimerRef.current), []);

  useLayoutEffect(() => {
    const element = tabsAreaRef.current;
    if (!element) return;

    const observer = new ResizeObserver(([entry]) => {
      setTabsWidth(Math.floor(entry.contentRect.width));
    });

    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  const conversationsById = new Map(
    conversations.map((conversation) => [conversation.friend.id, conversation])
  );

  const layout = getChatTabLayout(
    conversations.map((conversation) => conversation.friend.id),
    activeId,
    tabsWidth
  );

  const visibleTabs = layout.visibleIds.flatMap((id) => {
    const conversation = conversationsById.get(id);
    return conversation ? [conversation] : [];
  });

  const hiddenTabs = layout.hiddenIds.flatMap((id) => {
    const conversation = conversationsById.get(id);
    return conversation ? [conversation] : [];
  });

  const showMenu = isMenuOpen && hiddenTabs.length > 0;
  const isLastTab = conversations.length === 1;
  const moreLabel = t("more_conversations", { count: hiddenTabs.length });

  const closeMenu = useCallback(() => setIsMenuOpen(false), []);
  useDismiss(overflowRef, showMenu, closeMenu);

  // Opening a tab or narrowing the window still shrinks a frozen width.
  const tabWidth =
    frozenTabWidth === null
      ? layout.tabWidth
      : Math.min(frozenTabWidth, layout.tabWidth);
  const isCompact = tabWidth < CHAT_TAB_COMPACT_WIDTH;

  const tabs = visibleTabs.map((conversation, index) => ({
    conversation,
    isActive: conversation.friend.id === activeId,
    offset: index * (tabWidth + CHAT_TAB_GAP),
  }));

  const closeTab = (id: string) => {
    // A keyboard close has no pointer to leave the strip and release it.
    if (tabsAreaRef.current?.matches(":hover")) setFrozenTabWidth(tabWidth);
    onClose(id);
  };

  // Each slot spans its tab plus the gap after it, so tabs moving aside
  // during a drag clear the gap too.
  const measureSlots = (): TabSlot[] =>
    tabs.map(({ conversation: { friend } }) => {
      const element = tabRefs.current.get(friend.id);
      return {
        id: friend.id,
        left: element?.offsetLeft ?? 0,
        width: (element?.offsetWidth ?? 0) + CHAT_TAB_GAP,
      };
    });

  // Like Chrome, pressing a tab activates it; moving past the threshold
  // starts a drag.
  const handlePointerDown =
    (id: string) => (event: React.PointerEvent<HTMLDivElement>) => {
      if (event.button !== 0 || dragRef.current) return;
      // Links and the close button inside a tab keep their own clicks.
      if ((event.target as HTMLElement).closest(".chat-window__tab-action")) {
        return;
      }

      onSelect(id);
      event.currentTarget.setPointerCapture(event.pointerId);
      dragRef.current = {
        id,
        pointerId: event.pointerId,
        startX: event.clientX,
        offset: 0,
        started: false,
        dropping: false,
        fromIndex: 0,
        toIndex: 0,
        slots: [],
      };
    };

  const handlePointerMove = (event: React.PointerEvent<HTMLDivElement>) => {
    const current = dragRef.current;
    if (!current || current.pointerId !== event.pointerId || current.dropping) {
      return;
    }

    const delta = event.clientX - current.startX;
    let next = current;

    if (!current.started) {
      if (Math.abs(delta) < DRAG_THRESHOLD) return;

      const slots = measureSlots();
      const fromIndex = slots.findIndex((slot) => slot.id === current.id);
      if (fromIndex === -1 || slots.length < 2) return;

      next = {
        ...current,
        started: true,
        slots,
        fromIndex,
        toIndex: fromIndex,
      };
    }

    const dragOffset = clampDragOffset(next.slots, next.fromIndex, delta);
    next = {
      ...next,
      offset: dragOffset,
      toIndex: getDragTargetIndex(next.slots, next.fromIndex, dragOffset),
    };

    dragRef.current = next;
    setDrag(next);
  };

  const handlePointerUp = (event: React.PointerEvent<HTMLDivElement>) => {
    const current = dragRef.current;
    if (!current || current.pointerId !== event.pointerId || current.dropping) {
      return;
    }

    if (!current.started) {
      dragRef.current = null;
      return;
    }

    // Glide into the target slot, then commit the order in the same render
    // that clears the transforms, so nothing jumps.
    const dropped = {
      ...current,
      dropping: true,
      offset: getDropOffset(current.slots, current.fromIndex, current.toIndex),
    };
    dragRef.current = dropped;
    setDrag(dropped);

    settleTimerRef.current = window.setTimeout(() => {
      if (current.toIndex !== current.fromIndex) {
        onReorder(
          moveItem(
            current.slots.map((slot) => slot.id),
            current.fromIndex,
            current.toIndex
          )
        );
      }
      dragRef.current = null;
      setDrag(null);
    }, SETTLE_MS);
  };

  const getDragStyle = (
    id: string,
    index: number
  ): React.CSSProperties | undefined => {
    if (!drag?.started) return undefined;

    if (id === drag.id) {
      return {
        zIndex: 3,
        transform: `translateX(${drag.offset}px)`,
        transition: drag.dropping
          ? `transform ${SETTLE_MS}ms ease-out`
          : "none",
      };
    }

    const shift = getTabShift(
      index,
      drag.fromIndex,
      drag.toIndex,
      drag.slots[drag.fromIndex].width
    );

    return { transform: `translateX(${shift}px)` };
  };

  const isDragging = Boolean(drag?.started);

  return (
    <div className="chat-window__strip">
      <div
        className="chat-window__tabs-area"
        ref={tabsAreaRef}
        onPointerLeave={() => setFrozenTabWidth(null)}
      >
        <div
          className={cn("chat-window__tabs", {
            "chat-window__tabs--dragging": isDragging,
          })}
          role="tablist"
          aria-label={t("conversations")}
        >
          {tabs.map((tab, index) => {
            const { id } = tab.conversation.friend;

            return (
              <ChatTab
                key={id}
                conversation={tab.conversation}
                isActive={tab.isActive}
                isCompact={isCompact}
                width={tabWidth}
                isLastTab={isLastTab}
                alignCardToEnd={tab.offset + FRIEND_CARD_WIDTH > tabsWidth}
                dragStyle={getDragStyle(id, index)}
                tabRef={(element) => {
                  if (element) tabRefs.current.set(id, element);
                  else tabRefs.current.delete(id);
                }}
                onPointerDown={handlePointerDown(id)}
                onPointerMove={handlePointerMove}
                onPointerUp={handlePointerUp}
                onSelect={() => onSelect(id)}
                onClose={() => closeTab(id)}
              />
            );
          })}
        </div>

        {hiddenTabs.length > 0 && (
          <div className="chat-window__overflow" ref={overflowRef}>
            <button
              type="button"
              className={cn("chat-window__overflow-button", {
                "chat-window__overflow-button--open": showMenu,
              })}
              aria-haspopup="menu"
              aria-expanded={showMenu}
              aria-label={moreLabel}
              title={moreLabel}
              onClick={() => setIsMenuOpen((open) => !open)}
            >
              {hiddenTabs.length}
              <ChevronDownIcon size={12} />
            </button>

            {showMenu && (
              <div
                className="chat-window__overflow-menu"
                role="menu"
                aria-label={moreLabel}
              >
                <span className="chat-window__overflow-title">{moreLabel}</span>

                {hiddenTabs.map(({ friend, isTyping, unreadCount }) => (
                  <div key={friend.id} className="chat-window__overflow-item">
                    <button
                      type="button"
                      role="menuitem"
                      className="chat-window__overflow-select"
                      onClick={() => {
                        onSelect(friend.id);
                        setIsMenuOpen(false);
                      }}
                    >
                      <ChatFriendAvatar friend={friend} size={24} />
                      <span className="chat-window__overflow-details">
                        <span className="chat-window__overflow-name">
                          {friend.displayName}
                        </span>
                        <ChatFriendStatus friend={friend} isTyping={isTyping} />
                      </span>
                      {unreadCount > 0 && (
                        <span className="chat-window__unread-badge">
                          {unreadCount}
                        </span>
                      )}
                    </button>

                    <button
                      type="button"
                      className="chat-window__icon-button chat-window__icon-button--small"
                      onClick={() => onClose(friend.id)}
                      title={t("close_conversation")}
                      aria-label={t("close_conversation_with", {
                        name: friend.displayName,
                      })}
                    >
                      <XIcon size={12} />
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </div>

      <div className="chat-window__window-controls">
        <button
          type="button"
          className="chat-window__window-control"
          onClick={onMinimize}
          title={t("minimize")}
          aria-label={t("minimize")}
        >
          <DashIcon size={16} />
        </button>
        <button
          type="button"
          className="chat-window__window-control chat-window__window-control--close"
          onClick={onCloseWindow}
          title={t("close_window")}
          aria-label={t("close_window")}
        >
          <XIcon size={16} />
        </button>
      </div>
    </div>
  );
}
