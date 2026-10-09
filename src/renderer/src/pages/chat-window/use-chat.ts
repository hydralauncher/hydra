import { useCallback, useEffect, useRef, useState } from "react";

import type { ChatMessageDto, ChatMessagesPage } from "@types";

import {
  createSendCooldown,
  getRateLimitWindowStart,
  type ChatSendCooldown,
} from "./chat-rate-limit";
import {
  createPendingMessage,
  getLatestSeq,
  hasGapBefore,
  mergeChatMessages,
  setMessageStatus,
  toChatMessage,
} from "./chat-state";
import type { ChatConversation } from "./chat-types";

const electron = globalThis.electron as Electron;

const PAGE_SIZE = 50;
const MAX_PAGE_SIZE = 100;
/** The server relays at most one typing event per 3 seconds anyway. */
const TYPING_PING_INTERVAL_MS = 3_000;
const TYPING_INDICATOR_TIMEOUT_MS = 5_000;
const MARK_READ_DEBOUNCE_MS = 500;
const NOT_FRIENDS_ERROR = "chat/not-friends";
const RATE_LIMITED_ERROR = "chat/rate-limited";

const chatPath = (friendId: string, suffix: string) =>
  `/profile/chats/${friendId}/${suffix}`;

const fetchMessages = (
  friendId: string,
  params: { before?: number; after?: number; take: number }
) =>
  electron.hydraApi.get<ChatMessagesPage>(chatPath(friendId, "messages"), {
    params,
  });

const isNotFriendsError = (error: unknown) =>
  error instanceof Error && error.message.includes(NOT_FRIENDS_ERROR);

const isRateLimitedError = (error: unknown) =>
  error instanceof Error && error.message.includes(RATE_LIMITED_ERROR);

const useWindowFocus = () => {
  const [isFocused, setIsFocused] = useState(() => document.hasFocus());

  useEffect(() => {
    const update = () =>
      setIsFocused(
        document.hasFocus() && document.visibilityState === "visible"
      );

    window.addEventListener("focus", update);
    window.addEventListener("blur", update);
    document.addEventListener("visibilitychange", update);

    return () => {
      window.removeEventListener("focus", update);
      window.removeEventListener("blur", update);
      document.removeEventListener("visibilitychange", update);
    };
  }, []);

  return isFocused;
};

interface UseChatOptions {
  conversations: ChatConversation[];
  activeId: string | null;
  updateConversation: (
    friendId: string,
    update: (conversation: ChatConversation) => ChatConversation
  ) => void;
}

export function useChat({
  conversations,
  activeId,
  updateConversation,
}: UseChatOptions) {
  const isFocused = useWindowFocus();

  const conversationsRef = useRef(conversations);
  const activeIdRef = useRef(activeId);
  const isFocusedRef = useRef(isFocused);
  const lastTypingPingRef = useRef(new Map<string, number>());
  const typingTimersRef = useRef(
    new Map<string, ReturnType<typeof setTimeout>>()
  );
  const lastMarkedSeqRef = useRef(new Map<string, number>());

  // The rate limit is per user, so one cooldown covers every conversation.
  const [sendCooldown, setSendCooldown] = useState<ChatSendCooldown | null>(
    null
  );
  /** Bumped on every send the rate limit turns away, to shake the composer. */
  const [sendRejections, setSendRejections] = useState(0);
  const sendCooldownRef = useRef<ChatSendCooldown | null>(null);
  const rateLimitWindowRef = useRef<number | null>(null);

  useEffect(() => {
    conversationsRef.current = conversations;
    activeIdRef.current = activeId;
    isFocusedRef.current = isFocused;
  }, [conversations, activeId, isFocused]);

  useEffect(() => {
    const timers = typingTimersRef.current;
    return () => timers.forEach(clearTimeout);
  }, []);

  useEffect(() => {
    if (!sendCooldown) return;

    const timer = setTimeout(() => {
      sendCooldownRef.current = null;
      setSendCooldown(null);
    }, sendCooldown.until - Date.now());

    return () => clearTimeout(timer);
  }, [sendCooldown]);

  const isCoolingDown = useCallback(
    () => (sendCooldownRef.current?.until ?? 0) > Date.now(),
    []
  );

  const rejectSend = useCallback(() => {
    setSendRejections((count) => count + 1);
  }, []);

  const findConversation = useCallback(
    (friendId: string) =>
      conversationsRef.current.find(
        (conversation) => conversation.friend.id === friendId
      ),
    []
  );

  const loadLatest = useCallback(
    async (friendId: string, { replace = false } = {}) => {
      updateConversation(friendId, (conversation) => ({
        ...conversation,
        loadState: conversation.loadState === "loaded" ? "loaded" : "loading",
      }));

      try {
        const page = await fetchMessages(friendId, { take: PAGE_SIZE });
        const messages = page.messages.map((message) =>
          toChatMessage(message, friendId, true)
        );

        updateConversation(friendId, (conversation) => {
          const isFirstLoad = conversation.loadState !== "loaded";
          const kept = replace
            ? conversation.messages.filter(
                (message) => message.seq === undefined
              )
            : conversation.messages;

          return {
            ...conversation,
            messages: mergeChatMessages(kept, messages),
            canSend: page.canSend,
            hasMoreBefore:
              isFirstLoad || replace
                ? page.hasMore
                : conversation.hasMoreBefore,
            loadState: "loaded",
          };
        });
      } catch {
        updateConversation(friendId, (conversation) => ({
          ...conversation,
          loadState: conversation.loadState === "loaded" ? "loaded" : "error",
        }));
      }
    },
    [updateConversation]
  );

  const loadNewerThan = useCallback(
    async (friendId: string, afterSeq: number) => {
      try {
        const page = await fetchMessages(friendId, {
          after: afterSeq,
          take: MAX_PAGE_SIZE,
        });

        // More missed messages than one page: start over from the latest page
        // instead of paging forward through all of them.
        if (page.hasMore) {
          await loadLatest(friendId, { replace: true });
          return;
        }

        updateConversation(friendId, (conversation) => ({
          ...conversation,
          canSend: page.canSend,
          messages: mergeChatMessages(
            conversation.messages,
            page.messages.map((message) =>
              toChatMessage(message, friendId, true)
            )
          ),
        }));
      } catch {
        // The next resync or incoming message retries the gap.
      }
    },
    [loadLatest, updateConversation]
  );

  const loadOlder = useCallback(
    async (friendId: string) => {
      const conversation = findConversation(friendId);
      if (
        !conversation ||
        conversation.isLoadingOlder ||
        !conversation.hasMoreBefore
      ) {
        return;
      }

      const oldestSeq = conversation.messages.find(
        (message) => message.seq !== undefined
      )?.seq;
      if (oldestSeq === undefined) return;

      updateConversation(friendId, (current) => ({
        ...current,
        isLoadingOlder: true,
      }));

      try {
        const page = await fetchMessages(friendId, {
          before: oldestSeq,
          take: PAGE_SIZE,
        });

        updateConversation(friendId, (current) => ({
          ...current,
          isLoadingOlder: false,
          hasMoreBefore: page.hasMore,
          messages: mergeChatMessages(
            current.messages,
            page.messages.map((message) =>
              toChatMessage(message, friendId, true)
            )
          ),
        }));
      } catch {
        updateConversation(friendId, (current) => ({
          ...current,
          isLoadingOlder: false,
        }));
      }
    },
    [findConversation, updateConversation]
  );

  const deliver = useCallback(
    async (friendId: string, text: string, clientNonce: string) => {
      const windowStart = getRateLimitWindowStart(
        rateLimitWindowRef.current,
        Date.now()
      );
      rateLimitWindowRef.current = windowStart;

      try {
        const stored = await electron.hydraApi.post<ChatMessageDto>(
          chatPath(friendId, "messages"),
          { data: { body: text, clientNonce } }
        );

        updateConversation(friendId, (conversation) => ({
          ...conversation,
          messages: mergeChatMessages(conversation.messages, [
            toChatMessage(stored, friendId),
          ]),
        }));
      } catch (error) {
        if (isRateLimitedError(error)) {
          // Sends in flight together can all be turned away; the first one
          // starts the countdown and the rest leave it running.
          if (!isCoolingDown()) {
            const cooldown = createSendCooldown(windowStart, Date.now());
            sendCooldownRef.current = cooldown;
            setSendCooldown(cooldown);
          }
          rejectSend();
        }

        updateConversation(friendId, (conversation) => ({
          ...conversation,
          canSend: isNotFriendsError(error) ? false : conversation.canSend,
          messages: setMessageStatus(
            conversation.messages,
            clientNonce,
            "failed"
          ),
        }));
      }
    },
    [isCoolingDown, rejectSend, updateConversation]
  );

  const send = useCallback(
    (friendId: string, text: string) => {
      if (isCoolingDown()) {
        rejectSend();
        return;
      }

      const clientNonce = crypto.randomUUID();

      updateConversation(friendId, (conversation) => ({
        ...conversation,
        draft: "",
        messages: [
          ...conversation.messages,
          createPendingMessage(text, clientNonce),
        ],
      }));
      lastTypingPingRef.current.delete(friendId);

      void deliver(friendId, text, clientNonce);
    },
    [deliver, isCoolingDown, rejectSend, updateConversation]
  );

  const retry = useCallback(
    (friendId: string, clientNonce: string) => {
      const message = findConversation(friendId)?.messages.find(
        (current) => current.clientNonce === clientNonce
      );
      if (!message || message.status !== "failed") return;

      if (isCoolingDown()) {
        rejectSend();
        return;
      }

      updateConversation(friendId, (conversation) => ({
        ...conversation,
        messages: setMessageStatus(
          conversation.messages,
          clientNonce,
          "pending"
        ),
      }));

      void deliver(friendId, message.text, clientNonce);
    },
    [deliver, findConversation, isCoolingDown, rejectSend, updateConversation]
  );

  const notifyTyping = useCallback(
    (friendId: string, draft: string) => {
      if (!draft.trim() || !findConversation(friendId)?.canSend) return;

      const now = Date.now();
      const lastPing = lastTypingPingRef.current.get(friendId) ?? 0;
      if (now - lastPing < TYPING_PING_INTERVAL_MS) return;

      lastTypingPingRef.current.set(friendId, now);
      electron.hydraApi.post(chatPath(friendId, "typing")).catch(() => {});
    },
    [findConversation]
  );

  const stopTyping = useCallback(
    (friendId: string) => {
      const timer = typingTimersRef.current.get(friendId);
      if (timer) clearTimeout(timer);
      typingTimersRef.current.delete(friendId);

      updateConversation(friendId, (conversation) =>
        conversation.isTyping
          ? { ...conversation, isTyping: false }
          : conversation
      );
    },
    [updateConversation]
  );

  // History loads once per tab; later updates come from realtime and resyncs.
  useEffect(() => {
    for (const conversation of conversations) {
      if (conversation.loadState === "idle") {
        void loadLatest(conversation.friend.id);
      }
    }
  }, [conversations, loadLatest]);

  useEffect(() => {
    const unsubscribeMessage = electron.onChatMessage(
      ({ friendId, message }) => {
        const conversation = findConversation(friendId);
        if (!conversation) return;

        const incoming = toChatMessage(message, friendId);
        const isKnown = conversation.messages.some(
          (current) =>
            current.clientNonce === incoming.clientNonce &&
            current.seq !== undefined
        );
        const isVisible =
          activeIdRef.current === friendId && isFocusedRef.current;
        const isNewFromFriend = !incoming.fromMe && !isKnown;

        if (
          conversation.loadState === "loaded" &&
          hasGapBefore(conversation.messages, message.seq)
        ) {
          void loadNewerThan(friendId, getLatestSeq(conversation.messages));
        }

        if (isNewFromFriend) stopTyping(friendId);

        updateConversation(friendId, (current) => ({
          ...current,
          messages: mergeChatMessages(current.messages, [incoming]),
          unreadCount:
            isNewFromFriend && !isVisible
              ? current.unreadCount + 1
              : current.unreadCount,
        }));
      }
    );

    const unsubscribeTyping = electron.onChatTyping(({ friendId }) => {
      if (!findConversation(friendId)) return;

      const timer = typingTimersRef.current.get(friendId);
      if (timer) clearTimeout(timer);
      typingTimersRef.current.set(
        friendId,
        setTimeout(() => stopTyping(friendId), TYPING_INDICATOR_TIMEOUT_MS)
      );

      updateConversation(friendId, (conversation) => ({
        ...conversation,
        isTyping: true,
      }));
    });

    const unsubscribeResync = electron.onChatResync(() => {
      for (const conversation of conversationsRef.current) {
        const latestSeq = getLatestSeq(conversation.messages);
        if (conversation.loadState !== "loaded" || latestSeq === 0) {
          void loadLatest(conversation.friend.id);
        } else {
          void loadNewerThan(conversation.friend.id, latestSeq);
        }
      }
    });

    return () => {
      unsubscribeMessage();
      unsubscribeTyping();
      unsubscribeResync();
    };
  }, [
    findConversation,
    loadLatest,
    loadNewerThan,
    stopTyping,
    updateConversation,
  ]);

  const openFriendIds = conversations
    .map((conversation) => conversation.friend.id)
    .join(",");

  useEffect(() => {
    void electron.setChatWindowState({
      activeFriendId: activeId,
      openFriendIds: openFriendIds ? openFriendIds.split(",") : [],
    });
  }, [activeId, openFriendIds]);

  const activeConversation = conversations.find(
    (conversation) => conversation.friend.id === activeId
  );
  const activeLatestSeq = activeConversation
    ? getLatestSeq(activeConversation.messages)
    : 0;
  const activeIsLoaded = activeConversation?.loadState === "loaded";
  const activeHasUnread = Boolean(activeConversation?.unreadCount);

  useEffect(() => {
    if (!activeId || !isFocused || !activeIsLoaded) return;

    if (activeHasUnread) {
      updateConversation(activeId, (conversation) => ({
        ...conversation,
        unreadCount: 0,
      }));
    }

    if (
      activeLatestSeq === 0 ||
      (lastMarkedSeqRef.current.get(activeId) ?? 0) >= activeLatestSeq
    ) {
      return;
    }

    const timer = setTimeout(() => {
      lastMarkedSeqRef.current.set(activeId, activeLatestSeq);
      void electron.markChatRead(activeId, activeLatestSeq);
    }, MARK_READ_DEBOUNCE_MS);

    return () => clearTimeout(timer);
  }, [
    activeId,
    isFocused,
    activeIsLoaded,
    activeLatestSeq,
    activeHasUnread,
    updateConversation,
  ]);

  return {
    send,
    retry,
    loadOlder,
    loadLatest,
    notifyTyping,
    sendCooldown,
    sendRejections,
  };
}
