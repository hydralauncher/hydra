import { useCallback, useEffect, useRef, useState } from "react";

import type {
  ChatMessageDto,
  ChatMessageReactionsDto,
  ChatMessagesPage,
} from "@types";

import {
  createSendCooldown,
  getRateLimitWindowStart,
  type ChatSendCooldown,
} from "./chat-rate-limit";
import type { ChatMessage, ChatReaction } from "./chat-message-groups";
import {
  applyReaction,
  mergeReactions,
  updateMessageReactions,
} from "./chat-reactions";
import {
  createPendingMessage,
  createReply,
  findGapAfter,
  getLatestSeq,
  mergeChatMessages,
  setMessageStatus,
  toChatMessage,
  toChatReactions,
} from "./chat-state";
import type { ChatConversation } from "./chat-types";

const electron = globalThis.electron as Electron;

const PAGE_SIZE = 50;
const MAX_PAGE_SIZE = 100;
/** The server relays at most one typing event per 3 seconds anyway. */
const TYPING_PING_INTERVAL_MS = 3_000;
const TYPING_INDICATOR_TIMEOUT_MS = 5_000;
const MARK_READ_DEBOUNCE_MS = 500;
const REACTION_ERROR_DURATION_MS = 5_000;
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

/** Sets the user's reaction on the message; null removes it. */
const sendReaction = (friendId: string, seq: number, emoji: string | null) => {
  const path = chatPath(friendId, `messages/${seq}/reaction`);

  return emoji === null
    ? electron.hydraApi.delete<ChatMessageReactionsDto>(path)
    : electron.hydraApi.put<ChatMessageReactionsDto>(path, { data: { emoji } });
};

const isNotFriendsError = (error: unknown) =>
  error instanceof Error && error.message.includes(NOT_FRIENDS_ERROR);

const isRateLimitedError = (error: unknown) =>
  error instanceof Error && error.message.includes(RATE_LIMITED_ERROR);

export type ChatReactionErrorKind = "failed" | "rate_limited";

const byUpdatedAt = (a: ChatReaction, b: ChatReaction) =>
  Date.parse(a.updatedAt) - Date.parse(b.updatedAt);

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
  const newerLoadsRef = useRef(new Map<string, Promise<boolean>>());
  /** Bumped on every resync, so reads that failed while offline go out again. */
  const [resyncCount, setResyncCount] = useState(0);

  // The rate limit is per user, so one cooldown covers every conversation.
  const [sendCooldown, setSendCooldown] = useState<ChatSendCooldown | null>(
    null
  );
  /** Bumped on every send the rate limit turns away, to shake the composer. */
  const [sendRejections, setSendRejections] = useState(0);
  const sendCooldownRef = useRef<ChatSendCooldown | null>(null);
  const rateLimitWindowRef = useRef<number | null>(null);

  const [reactionError, setReactionError] = useState<{
    friendId: string;
    kind: ChatReactionErrorKind;
  } | null>(null);
  // The emoji each message's reaction should end up as, while a request for it
  // runs. Changes to one message go out one at a time, so a slow response
  // can't undo a newer pick and a failure can restore the saved reaction.
  const reactionTargetsRef = useRef(new Map<string, string | null>());

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
    if (!reactionError) return;

    const timer = setTimeout(
      () => setReactionError(null),
      REACTION_ERROR_DURATION_MS
    );
    return () => clearTimeout(timer);
  }, [reactionError]);

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
            gapAfterSeq: replace ? null : conversation.gapAfterSeq,
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

  /**
   * Loads the messages after `afterSeq`. Resolves to true when there were too
   * many and the conversation started over from the latest page instead.
   */
  const loadNewerThan = useCallback(
    (friendId: string, afterSeq: number) => {
      // Messages arriving while it runs would only repeat it.
      const running = newerLoadsRef.current.get(friendId);
      if (running) return running;

      const load = (async () => {
        try {
          const page = await fetchMessages(friendId, {
            after: afterSeq,
            take: MAX_PAGE_SIZE,
          });

          // More missed messages than one page: start over from the latest
          // page instead of paging forward through all of them.
          if (page.hasMore) {
            await loadLatest(friendId, { replace: true });
            return true;
          }

          updateConversation(friendId, (conversation) => ({
            ...conversation,
            canSend: page.canSend,
            // Everything after `afterSeq` is loaded now.
            gapAfterSeq:
              conversation.gapAfterSeq !== null &&
              conversation.gapAfterSeq >= afterSeq
                ? null
                : conversation.gapAfterSeq,
            messages: mergeChatMessages(
              conversation.messages,
              page.messages.map((message) =>
                toChatMessage(message, friendId, true)
              )
            ),
          }));
        } catch {
          // The gap stays recorded; the next resync or incoming message
          // retries it.
        } finally {
          newerLoadsRef.current.delete(friendId);
        }

        return false;
      })();

      newerLoadsRef.current.set(friendId, load);
      return load;
    },
    [loadLatest, updateConversation]
  );

  /**
   * Reloads every stored message from the oldest one loaded, for what changed
   * while offline: reactions on older messages only show up this way.
   */
  const refreshLoaded = useCallback(
    async (friendId: string) => {
      const oldestSeq = findConversation(friendId)?.messages.find(
        (message) => message.seq !== undefined
      )?.seq;
      if (oldestSeq === undefined) {
        await loadLatest(friendId);
        return;
      }

      const loaded: ChatMessage[] = [];
      let afterSeq = oldestSeq - 1;
      let canSend: boolean | null = null;
      let isComplete = false;

      try {
        while (!isComplete) {
          const page = await fetchMessages(friendId, {
            after: afterSeq,
            take: MAX_PAGE_SIZE,
          });

          loaded.push(
            ...page.messages.map((message) =>
              toChatMessage(message, friendId, true)
            )
          );
          canSend = page.canSend;
          afterSeq = page.messages.at(-1)?.seq ?? afterSeq;
          isComplete = !page.hasMore || page.messages.length === 0;
        }
      } catch {
        // Whatever loaded before the failure is still kept.
      }

      updateConversation(friendId, (conversation) => ({
        ...conversation,
        canSend: canSend ?? conversation.canSend,
        gapAfterSeq: isComplete ? null : conversation.gapAfterSeq,
        messages: mergeChatMessages(conversation.messages, loaded),
      }));
    },
    [findConversation, loadLatest, updateConversation]
  );

  const resyncConversation = useCallback(
    async (conversation: ChatConversation) => {
      const friendId = conversation.friend.id;
      const latestSeq = getLatestSeq(conversation.messages);
      if (conversation.loadState !== "loaded" || latestSeq === 0) {
        await loadLatest(friendId);
        return;
      }

      const isReplaced = await loadNewerThan(
        friendId,
        conversation.gapAfterSeq ?? latestSeq
      );
      // A fresh latest page already has current reactions.
      if (!isReplaced) await refreshLoaded(friendId);
    },
    [loadLatest, loadNewerThan, refreshLoaded]
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

  /**
   * Loads older history until the message with `seq` is in the conversation.
   * Resolves to whether it is there, so a jump to it can go ahead.
   */
  const loadThrough = useCallback(
    async (friendId: string, seq: number) => {
      const conversation = findConversation(friendId);
      if (!conversation) return false;

      let oldestSeq = conversation.messages.find(
        (message) => message.seq !== undefined
      )?.seq;
      if (oldestSeq === undefined) return false;
      if (oldestSeq <= seq) {
        return conversation.messages.some((message) => message.seq === seq);
      }
      if (conversation.isLoadingOlder || !conversation.hasMoreBefore) {
        return false;
      }

      updateConversation(friendId, (current) => ({
        ...current,
        isLoadingOlder: true,
      }));

      const loaded: ChatMessage[] = [];
      let hasMoreBefore = true;

      try {
        while (hasMoreBefore && oldestSeq > seq) {
          const page = await fetchMessages(friendId, {
            before: oldestSeq,
            take: MAX_PAGE_SIZE,
          });
          if (page.messages.length === 0) {
            hasMoreBefore = false;
            break;
          }

          loaded.push(
            ...page.messages.map((message) =>
              toChatMessage(message, friendId, true)
            )
          );
          oldestSeq = page.messages[0].seq;
          hasMoreBefore = page.hasMore;
        }
      } catch {
        // Whatever loaded before the failure is still kept.
      }

      updateConversation(friendId, (current) => ({
        ...current,
        isLoadingOlder: false,
        hasMoreBefore,
        messages: mergeChatMessages(current.messages, loaded),
      }));

      return loaded.some((message) => message.seq === seq);
    },
    [findConversation, updateConversation]
  );

  const deliver = useCallback(
    async (
      friendId: string,
      text: string,
      clientNonce: string,
      replyToSeq?: number
    ) => {
      const windowStart = getRateLimitWindowStart(
        rateLimitWindowRef.current,
        Date.now()
      );
      rateLimitWindowRef.current = windowStart;

      try {
        const stored = await electron.hydraApi.post<ChatMessageDto>(
          chatPath(friendId, "messages"),
          {
            data: {
              body: text,
              clientNonce,
              ...(replyToSeq ? { replyToSeq } : {}),
            },
          }
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

      const conversation = findConversation(friendId);
      const replyToSeq = conversation?.replyToSeq ?? null;
      const replyTarget =
        replyToSeq === null
          ? undefined
          : conversation?.messages.find(
              (message) => message.seq === replyToSeq
            );
      const replyTo = replyTarget ? createReply(replyTarget) : null;

      updateConversation(friendId, (current) => ({
        ...current,
        draft: "",
        replyToSeq: null,
        messages: [
          ...current.messages,
          createPendingMessage(text, clientNonce, undefined, replyTo),
        ],
      }));
      lastTypingPingRef.current.delete(friendId);

      void deliver(friendId, text, clientNonce, replyTo?.seq);
    },
    [deliver, findConversation, isCoolingDown, rejectSend, updateConversation]
  );

  const retry = useCallback(
    (friendId: string, clientNonce: string) => {
      const message = findConversation(friendId)?.messages.find(
        (current) => current.clientNonce === clientNonce
      );
      if (message?.status !== "failed") return;

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

      void deliver(friendId, message.text, clientNonce, message.replyTo?.seq);
    },
    [deliver, findConversation, isCoolingDown, rejectSend, updateConversation]
  );

  const react = useCallback(
    async (friendId: string, seq: number, emoji: string | null) => {
      const message = findConversation(friendId)?.messages.find(
        (current) => current.seq === seq
      );
      if (!message) return;

      setReactionError(null);
      updateConversation(friendId, (conversation) => ({
        ...conversation,
        messages: updateMessageReactions(
          conversation.messages,
          seq,
          (reactions) =>
            applyReaction(reactions, {
              fromMe: true,
              emoji,
              updatedAt: new Date().toISOString(),
              isPending: true,
            })
        ),
      }));

      const key = `${friendId}:${seq}`;
      const targets = reactionTargetsRef.current;
      const isSending = targets.has(key);
      targets.set(key, emoji);
      // The request already running sends this change once it settles.
      if (isSending) return;

      // Nothing was in flight, so this is the saved reaction.
      const savedMine = message.reactions?.find((reaction) => reaction.fromMe);
      let settled: ChatMessageReactionsDto | null = null;
      let failure: unknown = null;
      let target: string | null;

      do {
        target = targets.get(key) ?? null;
        try {
          settled = await sendReaction(friendId, seq, target);
          failure = null;
        } catch (error) {
          failure = error;
        }
      } while (targets.get(key) !== target);
      targets.delete(key);

      // A failed last change falls back to what the server last saved.
      const settle = (reactions: ChatReaction[]) =>
        settled
          ? mergeReactions(
              reactions,
              toChatReactions(settled.reactions, friendId),
              { settleMine: true }
            )
          : [
              ...reactions.filter((reaction) => !reaction.fromMe),
              ...(savedMine ? [savedMine] : []),
            ].sort(byUpdatedAt);

      updateConversation(friendId, (conversation) => ({
        ...conversation,
        canSend:
          failure !== null && isNotFriendsError(failure)
            ? false
            : conversation.canSend,
        messages: updateMessageReactions(conversation.messages, seq, settle),
      }));

      if (failure !== null) {
        setReactionError({
          friendId,
          kind: isRateLimitedError(failure) ? "rate_limited" : "failed",
        });
      }
    },
    [findConversation, updateConversation]
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

        const gapAfterSeq =
          conversation.loadState === "loaded"
            ? findGapAfter(conversation, message.seq)
            : null;
        if (gapAfterSeq !== null) void loadNewerThan(friendId, gapAfterSeq);

        if (isNewFromFriend) stopTyping(friendId);

        updateConversation(friendId, (current) => ({
          ...current,
          gapAfterSeq: current.gapAfterSeq ?? gapAfterSeq,
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

    const unsubscribeReaction = electron.onChatReaction(
      ({ friendId, seq, fromMe, emoji, updatedAt }) => {
        if (!findConversation(friendId)) return;

        updateConversation(friendId, (conversation) => ({
          ...conversation,
          messages: updateMessageReactions(
            conversation.messages,
            seq,
            (reactions) =>
              applyReaction(reactions, { fromMe, emoji, updatedAt })
          ),
        }));
      }
    );

    const unsubscribeResync = electron.onChatResync(() => {
      setResyncCount((count) => count + 1);

      for (const conversation of conversationsRef.current) {
        void resyncConversation(conversation);
      }
    });

    // Messages loaded after a reconnect come without notifications; the
    // refreshed counts still put dots on the tabs the user isn't looking at.
    const unsubscribeUnread = electron.onChatUnreadUpdated(({ byFriend }) => {
      for (const conversation of conversationsRef.current) {
        const friendId = conversation.friend.id;
        const unreadCount = byFriend[friendId] ?? 0;
        const isVisible =
          activeIdRef.current === friendId && isFocusedRef.current;
        if (isVisible || conversation.unreadCount === unreadCount) continue;

        updateConversation(friendId, (current) => ({
          ...current,
          unreadCount,
        }));
      }
    });

    return () => {
      unsubscribeMessage();
      unsubscribeTyping();
      unsubscribeReaction();
      unsubscribeResync();
      unsubscribeUnread();
    };
  }, [
    findConversation,
    loadNewerThan,
    resyncConversation,
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
  // Messages past a gap stay unread until the gap is loaded.
  const activeReadSeq = activeConversation
    ? (activeConversation.gapAfterSeq ??
      getLatestSeq(activeConversation.messages))
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
      activeReadSeq === 0 ||
      (lastMarkedSeqRef.current.get(activeId) ?? 0) >= activeReadSeq
    ) {
      return;
    }

    // Only a saved read is remembered; a failed one goes out again on
    // refocus or after the next resync.
    const timer = setTimeout(() => {
      void electron.markChatRead(activeId, activeReadSeq).then((isMarked) => {
        if (!isMarked) return;

        const markedSeq = lastMarkedSeqRef.current.get(activeId) ?? 0;
        lastMarkedSeqRef.current.set(
          activeId,
          Math.max(markedSeq, activeReadSeq)
        );
      });
    }, MARK_READ_DEBOUNCE_MS);

    return () => clearTimeout(timer);
  }, [
    activeId,
    isFocused,
    activeIsLoaded,
    activeReadSeq,
    activeHasUnread,
    resyncCount,
    updateConversation,
  ]);

  return {
    send,
    retry,
    react,
    reactionError,
    loadOlder,
    loadThrough,
    loadLatest,
    notifyTyping,
    sendCooldown,
    sendRejections,
  };
}
