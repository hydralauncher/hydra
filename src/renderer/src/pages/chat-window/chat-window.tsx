import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import cn from "classnames";

import { useFeature } from "@renderer/hooks/use-feature";
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
  draftImages: [],
  replyToSeq: null,
  canSend: true,
  loadState: "idle",
  hasMoreBefore: false,
  isLoadingOlder: false,
  gapAfterSeq: null,
});

export default function ChatWindow() {
  const { t } = useTranslation("chat_window");
  const { isFeatureEnabled, Feature } = useFeature();

  const [conversations, setConversations] = useState<ChatConversation[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  // Who the new conversation picker offers.
  const [friends, setFriends] = useState<UserFriend[]>([]);

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

  // Images that finish preparing after their tab closed are freed, not kept.
  const openIdsRef = useRef(new Set<string>());
  useEffect(() => {
    openIdsRef.current = new Set(
      conversations.map((conversation) => conversation.friend.id)
    );
  }, [conversations]);

  // Friend updates arrive in bursts; only the latest refresh may write, so a
  // slow, older response can't roll presence back.
  const friendsRequestIdRef = useRef(0);

  // Keeps presence and "playing" status of open conversations and the new
  // conversation picker current.
  const refreshFriends = useCallback(async () => {
    const requestId = ++friendsRequestIdRef.current;

    try {
      const response = await electron.hydraApi.get<ProfileFriends>(
        PROFILE_FRIENDS_PATH,
        { params: { take: FRIENDS_PAGE_SIZE, skip: 0 } }
      );
      if (requestId !== friendsRequestIdRef.current) return;

      setFriends(response.friends);

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
    const pending = await electron.consumePendingChatFriends();
    const last = pending.at(-1);
    if (!last) return;

    // Background tabs open for a message the user hasn't seen, so they start
    // with its unread badge.
    const unread = pending.some((entry) => entry.isBackground)
      ? await electron.getChatUnreadState().catch(() => null)
      : null;

    setConversations((current) =>
      pending.reduce((next, { friend, isBackground }) => {
        const existing = next.find(
          (conversation) => conversation.friend.id === friend.id
        );

        if (!existing) {
          return [
            ...next,
            {
              ...createConversation(friend),
              unreadCount: isBackground
                ? Math.max(unread?.byFriend[friend.id] ?? 0, 1)
                : 0,
            },
          ];
        }

        // An open tab already counts its own unread messages.
        if (isBackground) return next;

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

    // A background tab leaves the open conversation in place; it only gets
    // picked when no conversation is open yet.
    const foreground = pending.findLast((entry) => !entry.isBackground);
    setActiveId(
      (activeId) => foreground?.friend.id ?? activeId ?? last.friend.id
    );

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
      // Alt+Tab belongs to the OS window switcher, Ctrl+Tab to the tabs.
      if (event.key === "Tab" && !event.altKey && !event.ctrlKey) {
        setIsKeyboardNavigating(true);
      }
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
      void electron.closeChatWindow();
      return;
    }

    setConversations(remaining);
    openIdsRef.current.delete(friendId);
    for (const image of conversations[index].draftImages) {
      URL.revokeObjectURL(image.url);
    }
    chat.forgetConversation(friendId, conversations[index].messages);

    if (activeId === friendId) {
      // Like browser tabs, focus the right neighbour, else the left one.
      const next = remaining[index] ?? remaining[index - 1];
      handleSelect(next.friend.id);
    }
  };

  const handleOpenConversation = (friend: UserFriend) => {
    if (
      !conversations.some(
        (conversation) => conversation.friend.id === friend.id
      )
    ) {
      setConversations((current) => [...current, createConversation(friend)]);
    }

    handleSelect(friend.id);
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
        friends={friends}
        onRefreshFriends={() => void refreshFriends()}
        onOpenConversation={handleOpenConversation}
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
          imagesEnabled={isFeatureEnabled(Feature.ChatImages)}
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
          onDraftImagesChange={(update) => {
            const friendId = activeConversation.friend.id;
            if (!openIdsRef.current.has(friendId)) {
              for (const image of update([])) URL.revokeObjectURL(image.url);
              return;
            }
            updateConversation(friendId, (conversation) => ({
              ...conversation,
              draftImages: update(conversation.draftImages),
            }));
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
          onRemove={(clientNonce) =>
            chat.remove(activeConversation.friend.id, clientNonce)
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
