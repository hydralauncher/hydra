import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import cn from "classnames";

import { PROFILE_FRIENDS_PATH } from "@shared";
import type { ProfileFriends, UserFriend } from "@types";

import { ChatConversationView } from "./chat-conversation";
import { ChatConversationHeader } from "./chat-conversation-header";
import { playMessageSound } from "./chat-sounds";
import { applyVisibleOrder } from "./chat-tab-drag";
import { ChatTabStrip } from "./chat-tab-strip";
import type { ChatConversation } from "./chat-types";
import { useChat } from "./use-chat";

import "./chat-window.scss";

const FRIENDS_PAGE_SIZE = 100;
const electron = globalThis.electron as Electron;

const createConversation = (friend: UserFriend): ChatConversation => ({
  friend,
  messages: [],
  isTyping: false,
  unreadCount: 0,
  draft: "",
  replyToSeq: null,
  canSend: true,
  loadState: "idle",
  hasMoreBefore: false,
  isLoadingOlder: false,
});

export default function ChatWindow() {
  const { t } = useTranslation("chat_window");

  const [conversations, setConversations] = useState<ChatConversation[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);

  const updateConversation = useCallback(
    (
      friendId: string,
      update: (conversation: ChatConversation) => ChatConversation
    ) => {
      setConversations((current) =>
        current.map((conversation) =>
          conversation.friend.id === friendId
            ? update(conversation)
            : conversation
        )
      );
    },
    []
  );

  const chat = useChat({ conversations, activeId, updateConversation });

  // Friend updates arrive in bursts; only the latest refresh may write, so a
  // slow, older response can't roll presence back.
  const friendsRequestIdRef = useRef(0);

  // Keeps presence and "playing" status of open conversations current.
  const refreshFriends = useCallback(async () => {
    const requestId = ++friendsRequestIdRef.current;

    try {
      const response = await electron.hydraApi.get<ProfileFriends>(
        PROFILE_FRIENDS_PATH,
        { params: { take: FRIENDS_PAGE_SIZE, skip: 0 } }
      );
      if (requestId !== friendsRequestIdRef.current) return;

      const friendsById = new Map(
        response.friends.map((friend) => [friend.id, friend])
      );

      setConversations((current) =>
        current.map((conversation) => {
          const friend = friendsById.get(conversation.friend.id);
          return friend
            ? { ...conversation, friend: { ...conversation.friend, ...friend } }
            : conversation;
        })
      );
    } catch {
      // ignore transient errors; the next update will retry
    }
  }, []);

  const openPendingConversations = useCallback(async () => {
    const friends = await electron.consumePendingChatFriends();
    if (!friends.length) return;

    setConversations((current) =>
      friends.reduce((next, friend) => {
        const existing = next.find(
          (conversation) => conversation.friend.id === friend.id
        );

        if (!existing) return [...next, createConversation(friend)];

        return next.map((conversation) =>
          conversation === existing
            ? {
                ...conversation,
                friend: { ...conversation.friend, ...friend },
                unreadCount: 0,
              }
            : conversation
        );
      }, current)
    );

    setActiveId(friends[friends.length - 1].id);

    // The opener's copy can be stale, and one built from a message
    // notification has no presence or game at all. Realtime events only report
    // changes, so fetch the current state once.
    void refreshFriends();
  }, [refreshFriends]);

  useEffect(() => {
    document.title = t("title");
  }, [t]);

  // Chromium can move focus to the first tab as the window opens, ringed as
  // if the user had tabbed there. The tab ring waits for a real Tab press.
  const [isKeyboardNavigating, setIsKeyboardNavigating] = useState(false);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      // Alt+Tab belongs to the OS window switcher.
      if (event.key === "Tab" && !event.altKey) setIsKeyboardNavigating(true);
    };
    const handlePointerDown = () => setIsKeyboardNavigating(false);

    window.addEventListener("keydown", handleKeyDown, true);
    window.addEventListener("pointerdown", handlePointerDown, true);
    return () => {
      window.removeEventListener("keydown", handleKeyDown, true);
      window.removeEventListener("pointerdown", handlePointerDown, true);
    };
  }, []);

  useEffect(() => {
    openPendingConversations();

    const unsubscribePending = electron.onChatFriendsPending(() => {
      openPendingConversations();
    });
    // The main process decides when a message is worth a sound (see
    // showChatNotification); this window just plays it.
    const unsubscribeSound = electron.onChatMessageSound(() => {
      void playMessageSound();
    });
    const unsubscribeFriends = electron.onFriendsUpdated(() => {
      refreshFriends();
    });
    const unsubscribePresence = electron.onFriendPresence(
      ({ friendId, isOnline }) => {
        updateConversation(friendId, (conversation) => ({
          ...conversation,
          friend: { ...conversation.friend, isOnline },
        }));
      }
    );

    return () => {
      unsubscribePending();
      unsubscribeSound();
      unsubscribeFriends();
      unsubscribePresence();
    };
  }, [openPendingConversations, refreshFriends, updateConversation]);

  const handleSelect = (friendId: string) => {
    setActiveId(friendId);
    updateConversation(friendId, (conversation) => ({
      ...conversation,
      unreadCount: 0,
    }));
  };

  const handleClose = (friendId: string) => {
    const index = conversations.findIndex(
      (conversation) => conversation.friend.id === friendId
    );
    if (index === -1) return;

    const remaining = conversations.filter(
      (conversation) => conversation.friend.id !== friendId
    );

    // Closing the last conversation closes the window.
    if (remaining.length === 0) {
      electron.closeChatWindow();
      return;
    }

    setConversations(remaining);

    if (activeId === friendId) {
      // Like browser tabs, focus the right neighbour, else the left one.
      const next = remaining[index] ?? remaining[index - 1];
      handleSelect(next.friend.id);
    }
  };

  const handleReorder = (visibleOrder: string[]) => {
    setConversations((current) => {
      const byId = new Map(
        current.map((conversation) => [conversation.friend.id, conversation])
      );

      return applyVisibleOrder(
        current.map((conversation) => conversation.friend.id),
        visibleOrder
      ).flatMap((id) => byId.get(id) ?? []);
    });
  };

  const activeConversation =
    conversations.find((conversation) => conversation.friend.id === activeId) ??
    null;

  return (
    <div
      className={cn("chat-window", {
        "chat-window--keyboard-navigation": isKeyboardNavigating,
      })}
    >
      <ChatTabStrip
        conversations={conversations}
        activeId={activeId}
        onSelect={handleSelect}
        onClose={handleClose}
        onReorder={handleReorder}
        onMinimize={() => electron.minimizeChatWindow()}
        onCloseWindow={() => electron.closeChatWindow()}
      />

      {activeConversation && (
        <ChatConversationHeader
          friend={activeConversation.friend}
          isTyping={activeConversation.isTyping}
        />
      )}

      {activeConversation && (
        <ChatConversationView
          key={activeConversation.friend.id}
          conversation={activeConversation}
          sendCooldown={chat.sendCooldown}
          sendRejections={chat.sendRejections}
          onDraftChange={(draft) => {
            updateConversation(
              activeConversation.friend.id,
              (conversation) => ({
                ...conversation,
                draft,
              })
            );
            chat.notifyTyping(activeConversation.friend.id, draft);
          }}
          onReplyChange={(replyToSeq) =>
            updateConversation(
              activeConversation.friend.id,
              (conversation) => ({ ...conversation, replyToSeq })
            )
          }
          onSend={(text) => chat.send(activeConversation.friend.id, text)}
          onReact={(seq, emoji) =>
            void chat.react(activeConversation.friend.id, seq, emoji)
          }
          reactionError={
            chat.reactionError?.friendId === activeConversation.friend.id
              ? chat.reactionError.kind
              : null
          }
          onRetry={(clientNonce) =>
            chat.retry(activeConversation.friend.id, clientNonce)
          }
          onLoadOlder={() => chat.loadOlder(activeConversation.friend.id)}
          onLoadThrough={(seq) =>
            chat.loadThrough(activeConversation.friend.id, seq)
          }
          onReload={() => chat.loadLatest(activeConversation.friend.id)}
        />
      )}
    </div>
  );
}
