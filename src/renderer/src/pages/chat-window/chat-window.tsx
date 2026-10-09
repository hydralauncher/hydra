import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";

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
  }, []);

  // Keeps presence and "playing" status of open conversations current.
  const refreshFriends = useCallback(async () => {
    try {
      const response = await electron.hydraApi.get<ProfileFriends>(
        "/profile/friends",
        { params: { take: FRIENDS_PAGE_SIZE, skip: 0 } }
      );

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

  useEffect(() => {
    document.title = t("title");
  }, [t]);

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
    <div className="chat-window">
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
          onSend={(text) => chat.send(activeConversation.friend.id, text)}
          onRetry={(clientNonce) =>
            chat.retry(activeConversation.friend.id, clientNonce)
          }
          onLoadOlder={() => chat.loadOlder(activeConversation.friend.id)}
          onReload={() => chat.loadLatest(activeConversation.friend.id)}
        />
      )}
    </div>
  );
}
