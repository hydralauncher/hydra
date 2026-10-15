import { useCallback, useEffect, useRef, useState } from "react";

import type {
  ChatAttachmentContentType,
  ChatMessageDto,
  ChatMessageReactionsDto,
  ChatMessagesPage,
  ChatPendingMessageDto,
} from "@types";

import { getUploadProgress } from "./chat-attachments";
import {
  createSendCooldown,
  getRateLimitWindowStart,
  type ChatSendCooldown,
} from "./chat-rate-limit";
import type {
  ChatAttachment,
  ChatMessage,
  ChatReaction,
} from "./chat-message-groups";
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
  mergePendingMessages,
  removeUnsentMessage,
  setMessageAttachmentIds,
  setMessageFailed,
  setMessageStatus,
  setMessageUploadProgress,
  setMessageVisibility,
  settleSendingMessage,
  toChatMessage,
  toChatReactions,
  toPendingChatMessage,
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
/** A held message the server said nothing about for this long gets looked up. */
const PENDING_CHECK_TIMEOUT_MS = 20_000;
const PENDING_CHECK_MAX_LOOKUPS = 6;
const NOT_FRIENDS_ERROR = "chat/not-friends";
const RATE_LIMITED_ERROR = "chat/rate-limited";
const ATTACHMENT_NOT_FOUND_ERROR = "chat/attachment-not-found";
const ATTACHMENTS_DAILY_LIMIT_ERROR = "chat/attachments-daily-limit";

/** A message with images, from the composer until the server answers. */
interface OutgoingImages {
  friendId: string;
  text: string;
  replyToSeq?: number;
  /** Empty for a message restored from the server: its images are uploaded. */
  files: { blob: Blob; contentType: ChatAttachmentContentType }[];
  spoilers: boolean[];
  /** The server's attachment ids, filled in as uploads are reserved. */
  ids: (string | null)[];
  /** Bytes sent per image, for the progress bar. */
  loaded: number[];
}

const toUploadId = (clientNonce: string, index: number) =>
  `${clientNonce}:${index}`;

const fromUploadId = (uploadId: string) => {
  const separator = uploadId.lastIndexOf(":");
  return {
    clientNonce: uploadId.slice(0, separator),
    index: Number(uploadId.slice(separator + 1)),
  };
};

/** Progress in whole percent, so a burst of events renders once per step. */
const roundProgress = (progress: number) => Math.floor(progress * 100) / 100;

const revokeLocalCopies = (attachments: ChatAttachment[] = []) => {
  for (const attachment of attachments) {
    if (attachment.localUrl) URL.revokeObjectURL(attachment.localUrl);
  }
};

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

interface ReactionTargetsResult {
  /** The last reactions the server saved, if any request succeeded. */
  settled: ChatMessageReactionsDto | null;
  isFailed: boolean;
  error: unknown;
}

/**
 * Sends the reaction `targets` holds for `key`, one request at a time, until
 * it stops changing. Resolves with the last saved reactions and whether the
 * last request failed.
 */
const sendReactionTargets = async (
  targets: Map<string, string | null>,
  key: string,
  friendId: string,
  seq: number,
  previous: ChatMessageReactionsDto | null = null
): Promise<ReactionTargetsResult> => {
  const target = targets.get(key) ?? null;
  let result: ReactionTargetsResult;

  try {
    const settled = await sendReaction(friendId, seq, target);
    result = { settled, isFailed: false, error: null };
  } catch (error) {
    result = { settled: previous, isFailed: true, error };
  }

  return targets.get(key) === target
    ? result
    : sendReactionTargets(targets, key, friendId, seq, result.settled);
};

interface MessagesRange {
  messages: ChatMessageDto[];
  canSend: boolean | null;
  /** False when a failure stopped it before the newest message. */
  isComplete: boolean;
}

/**
 * Every stored message after `afterSeq`, a page at a time. Whatever loaded
 * before a failure is kept.
 */
const EMPTY_MESSAGES_RANGE: MessagesRange = {
  messages: [],
  canSend: null,
  isComplete: false,
};

type FetchMessages = typeof fetchMessages;

const fetchMessagesAfter = async (
  friendId: string,
  afterSeq: number,
  fetchPage: FetchMessages,
  range = EMPTY_MESSAGES_RANGE
): Promise<MessagesRange> => {
  let page: ChatMessagesPage;
  try {
    page = await fetchPage(friendId, {
      after: afterSeq,
      take: MAX_PAGE_SIZE,
    });
  } catch {
    return range;
  }

  const next = {
    messages: [...range.messages, ...page.messages],
    canSend: page.canSend,
    isComplete: false,
  };
  const lastSeq = page.messages.at(-1)?.seq;
  if (!page.hasMore || lastSeq === undefined) {
    return { ...next, isComplete: true };
  }

  return fetchMessagesAfter(friendId, lastSeq, fetchPage, next);
};

const isNotFriendsError = (error: unknown) =>
  error instanceof Error && error.message.includes(NOT_FRIENDS_ERROR);

const isRateLimitedError = (error: unknown) =>
  error instanceof Error && error.message.includes(RATE_LIMITED_ERROR);

const isAttachmentNotFoundError = (error: unknown) =>
  error instanceof Error && error.message.includes(ATTACHMENT_NOT_FOUND_ERROR);

const isAttachmentsDailyLimitError = (error: unknown) =>
  error instanceof Error &&
  error.message.includes(ATTACHMENTS_DAILY_LIMIT_ERROR);

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

  // Messages with images, by client nonce, until the server answers for them.
  const outgoingRef = useRef(new Map<string, OutgoingImages>());

  // When each message was last hidden, so a fetch that started earlier can't
  // bring it back.
  const hiddenAtRef = useRef(new Map<string, number>());
  const fetchPage = useCallback<FetchMessages>(async (friendId, params) => {
    const startedAt = Date.now();
    const page = await fetchMessages(friendId, params);
    return {
      ...page,
      messages: page.messages.map((message) =>
        (hiddenAtRef.current.get(`${friendId}:${message.seq}`) ?? 0) > startedAt
          ? { ...message, hidden: true }
          : message
      ),
    };
  }, []);
  // Held messages waiting for a realtime answer, by client nonce. Each one
  // looks the conversation up again if the answer doesn't come.
  const pendingChecksRef = useRef(
    new Map<string, { timer: ReturnType<typeof setTimeout>; lookups: number }>()
  );
  const lookUpPendingRef = useRef<(friendId: string) => Promise<void>>(
    async () => {}
  );

  useEffect(() => {
    conversationsRef.current = conversations;
    activeIdRef.current = activeId;
    isFocusedRef.current = isFocused;
  }, [conversations, activeId, isFocused]);

  useEffect(() => {
    const timers = typingTimersRef.current;
    const pendingChecks = pendingChecksRef.current;
    return () => {
      timers.forEach(clearTimeout);
      pendingChecks.forEach((check) => clearTimeout(check.timer));
    };
  }, []);

  const stopPendingCheck = useCallback((clientNonce: string) => {
    const check = pendingChecksRef.current.get(clientNonce);
    if (check) clearTimeout(check.timer);
    pendingChecksRef.current.delete(clientNonce);
  }, []);

  const watchPendingRef = useRef<
    (friendId: string, clientNonce: string) => void
  >(() => {});
  const watchPending = useCallback(
    (friendId: string, clientNonce: string) => {
      const previous = pendingChecksRef.current.get(clientNonce);
      if (previous) clearTimeout(previous.timer);

      const lookups = previous?.lookups ?? 0;
      if (lookups >= PENDING_CHECK_MAX_LOOKUPS) {
        pendingChecksRef.current.delete(clientNonce);
        // Out of lookups: Retry and Remove beat waiting on "Checking" forever.
        updateConversation(friendId, (conversation) => ({
          ...conversation,
          messages: setMessageFailed(conversation.messages, clientNonce),
        }));
        return;
      }

      const timer = setTimeout(() => {
        pendingChecksRef.current.set(clientNonce, {
          timer,
          lookups: lookups + 1,
        });
        void lookUpPendingRef.current(friendId).finally(() => {
          // A failed lookup leaves this check untouched, so it looks again.
          if (pendingChecksRef.current.get(clientNonce)?.timer === timer) {
            watchPendingRef.current(friendId, clientNonce);
          }
        });
      }, PENDING_CHECK_TIMEOUT_MS);
      pendingChecksRef.current.set(clientNonce, { timer, lookups });
    },
    [updateConversation]
  );
  useEffect(() => {
    watchPendingRef.current = watchPending;
  }, [watchPending]);

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
        const page = await fetchPage(friendId, { take: PAGE_SIZE });
        const messages = page.messages.map((message) =>
          toChatMessage(message, friendId, true)
        );
        const pendingDtos = page.pendingMessages ?? [];
        const pending = pendingDtos.map((dto) => {
          const message = toPendingChatMessage(dto);
          const target = messages.find(
            (current) => current.seq === dto.replyToSeq
          );
          const replyTo = target ? createReply(target) : null;
          return replyTo ? { ...message, replyTo } : message;
        });

        updateConversation(friendId, (conversation) => {
          const isFirstLoad = conversation.loadState !== "loaded";
          const kept = replace
            ? conversation.messages.filter(
                (message) => message.seq === undefined
              )
            : conversation.messages;

          return {
            ...conversation,
            messages: mergePendingMessages(
              mergeChatMessages(kept, messages),
              pending
            ),
            canSend: page.canSend,
            hasMoreBefore:
              isFirstLoad || replace
                ? page.hasMore
                : conversation.hasMoreBefore,
            gapAfterSeq: replace ? null : conversation.gapAfterSeq,
            loadState: "loaded",
          };
        });

        for (const message of page.messages) {
          stopPendingCheck(message.clientNonce);
        }
        for (const dto of pendingDtos) {
          if (dto.status === "checking")
            watchPending(friendId, dto.clientNonce);
          else stopPendingCheck(dto.clientNonce);
        }
      } catch {
        updateConversation(friendId, (conversation) => ({
          ...conversation,
          loadState: conversation.loadState === "loaded" ? "loaded" : "error",
        }));
      }
    },
    [fetchPage, stopPendingCheck, updateConversation, watchPending]
  );

  useEffect(() => {
    lookUpPendingRef.current = (friendId) => loadLatest(friendId);
  }, [loadLatest]);

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
          const page = await fetchPage(friendId, {
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
    [fetchPage, loadLatest, updateConversation]
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

      const range = await fetchMessagesAfter(
        friendId,
        oldestSeq - 1,
        fetchPage
      );
      const loaded = range.messages.map((message) =>
        toChatMessage(message, friendId, true)
      );

      updateConversation(friendId, (conversation) => ({
        ...conversation,
        canSend: range.canSend ?? conversation.canSend,
        gapAfterSeq: range.isComplete ? null : conversation.gapAfterSeq,
        messages: mergeChatMessages(conversation.messages, loaded),
      }));
    },
    [fetchPage, findConversation, loadLatest, updateConversation]
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

      // Held messages are only reported with the latest page; an answer for
      // one may have been lost while offline.
      const isChecking = conversation.messages.some(
        (message) => message.status === "checking"
      );
      if (!isReplaced && isChecking) await loadLatest(friendId);
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
        const page = await fetchPage(friendId, {
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
    [fetchPage, findConversation, updateConversation]
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
          const page = await fetchPage(friendId, {
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
    [fetchPage, findConversation, updateConversation]
  );

  /** Puts back a message moderation removed; the event carries no text. */
  const restoreMessage = useCallback(
    async (friendId: string, seq: number) => {
      try {
        const page = await fetchPage(friendId, { after: seq - 1, take: 1 });
        const restored = page.messages.find((message) => message.seq === seq);
        if (!restored || restored.hidden) return;

        updateConversation(friendId, (conversation) => ({
          ...conversation,
          // The stored copy brings back the image URLs as well.
          messages: mergeChatMessages(
            setMessageVisibility(conversation.messages, seq, restored.body),
            [toChatMessage(restored, friendId, true)]
          ),
        }));
      } catch {
        // It stays removed until the next resync reloads it.
      }
    },
    [fetchPage, updateConversation]
  );

  const startRateLimitWindow = useCallback(() => {
    const windowStart = getRateLimitWindowStart(
      rateLimitWindowRef.current,
      Date.now()
    );
    rateLimitWindowRef.current = windowStart;
    return windowStart;
  }, []);

  const failSend = useCallback(
    (
      friendId: string,
      clientNonce: string,
      error: unknown,
      windowStart: number
    ) => {
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
        messages: setMessageFailed(
          conversation.messages,
          clientNonce,
          isAttachmentsDailyLimitError(error) ? "daily_limit" : undefined
        ),
      }));
    },
    [isCoolingDown, rejectSend, updateConversation]
  );

  /**
   * Uploads whatever images of the message are not up yet, then posts it. The
   * server holds it until the images pass moderation; a realtime event says
   * how that went.
   */
  const deliverImages = useCallback(
    async (clientNonce: string) => {
      const outgoing = outgoingRef.current.get(clientNonce);
      if (!outgoing) return;

      const { friendId } = outgoing;
      const windowStart = startRateLimitWindow();

      try {
        // Every upload settles before Retry shows, so a retry never uploads
        // an image that is still on its way.
        const uploads = await Promise.allSettled(
          outgoing.files.map(async (file, index) => {
            if (outgoing.ids[index]) return;

            const { id } = await electron.uploadChatAttachment({
              friendId,
              uploadId: toUploadId(clientNonce, index),
              contentType: file.contentType,
              bytes: await file.blob.arrayBuffer(),
            });
            outgoing.ids[index] = id;
          })
        );
        const failedUpload = uploads.find(
          (upload): upload is PromiseRejectedResult =>
            upload.status === "rejected"
        );
        if (failedUpload) throw failedUpload.reason;

        const ids = outgoing.ids.filter((id): id is string => id !== null);
        updateConversation(friendId, (conversation) => ({
          ...conversation,
          messages: setMessageAttachmentIds(
            setMessageUploadProgress(conversation.messages, clientNonce, 1),
            clientNonce,
            ids
          ),
        }));

        const response = await electron.hydraApi.postResponse<
          ChatMessageDto | ChatPendingMessageDto
        >(chatPath(friendId, "messages"), {
          data: {
            ...(outgoing.text ? { body: outgoing.text } : {}),
            clientNonce,
            ...(outgoing.replyToSeq ? { replyToSeq: outgoing.replyToSeq } : {}),
            attachments: ids.map((id, index) => ({
              id,
              spoiler: outgoing.spoilers[index] ?? false,
            })),
          },
          acceptedStatuses: [201, 202],
        });

        if (response.status === 201) {
          outgoingRef.current.delete(clientNonce);
          updateConversation(friendId, (conversation) => ({
            ...conversation,
            messages: mergeChatMessages(conversation.messages, [
              toChatMessage(response.data as ChatMessageDto, friendId),
            ]),
          }));
          return;
        }

        const { status } = response.data as ChatPendingMessageDto;
        updateConversation(friendId, (conversation) => ({
          ...conversation,
          messages: settleSendingMessage(
            conversation.messages,
            clientNonce,
            status
          ),
        }));
        if (status === "checking") watchPending(friendId, clientNonce);
      } catch (error) {
        // Reserved uploads that the server no longer has go up again on retry.
        if (isAttachmentNotFoundError(error) && outgoing.files.length > 0) {
          outgoing.ids.fill(null);
          outgoing.loaded.fill(0);
        }
        failSend(friendId, clientNonce, error, windowStart);
      }
    },
    [failSend, startRateLimitWindow, updateConversation, watchPending]
  );

  const deliver = useCallback(
    async (
      friendId: string,
      text: string,
      clientNonce: string,
      replyToSeq?: number
    ) => {
      const windowStart = startRateLimitWindow();

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
        failSend(friendId, clientNonce, error, windowStart);
      }
    },
    [failSend, startRateLimitWindow, updateConversation]
  );

  /** Sends the conversation's draft: its text, and its images if it has any. */
  const send = useCallback(
    (friendId: string, text: string) => {
      if (isCoolingDown()) {
        rejectSend();
        return;
      }

      const clientNonce = crypto.randomUUID();

      const conversation = findConversation(friendId);
      const images = conversation?.draftImages ?? [];
      const replyToSeq = conversation?.replyToSeq ?? null;
      const replyTarget =
        replyToSeq === null
          ? undefined
          : conversation?.messages.find(
              (message) => message.seq === replyToSeq
            );
      const replyTo = replyTarget ? createReply(replyTarget) : null;

      const attachments: ChatAttachment[] = images.map((image) => ({
        id: image.id,
        contentType: image.contentType,
        width: image.width,
        height: image.height,
        spoiler: image.spoiler,
        url: null,
        localUrl: image.url,
      }));

      updateConversation(friendId, (current) => ({
        ...current,
        draft: "",
        draftImages: [],
        replyToSeq: null,
        messages: [
          ...current.messages,
          createPendingMessage(
            text,
            clientNonce,
            undefined,
            replyTo,
            attachments
          ),
        ],
      }));
      lastTypingPingRef.current.delete(friendId);

      if (images.length === 0) {
        void deliver(friendId, text, clientNonce, replyTo?.seq);
        return;
      }

      outgoingRef.current.set(clientNonce, {
        friendId,
        text,
        replyToSeq: replyTo?.seq,
        files: images.map(({ blob, contentType }) => ({ blob, contentType })),
        spoilers: images.map((image) => image.spoiler),
        ids: images.map(() => null),
        loaded: images.map(() => 0),
      });
      void deliverImages(clientNonce);
    },
    [
      deliver,
      deliverImages,
      findConversation,
      isCoolingDown,
      rejectSend,
      updateConversation,
    ]
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

      if (!message.attachments?.length) {
        updateConversation(friendId, (conversation) => ({
          ...conversation,
          messages: setMessageStatus(
            conversation.messages,
            clientNonce,
            "pending"
          ),
        }));

        void deliver(friendId, message.text, clientNonce, message.replyTo?.seq);
        return;
      }

      // A message restored from the server has its images up already.
      let outgoing = outgoingRef.current.get(clientNonce);
      if (!outgoing) {
        outgoing = {
          friendId,
          text: message.text,
          replyToSeq: message.replyTo?.seq,
          files: [],
          spoilers: message.attachments.map((attachment) => attachment.spoiler),
          ids: message.attachments.map((attachment) => attachment.id),
          loaded: message.attachments.map(() => 0),
        };
        outgoingRef.current.set(clientNonce, outgoing);
      }

      const sizes = outgoing.files.map((file) => file.blob.size);
      const progress = outgoing.ids.every(Boolean)
        ? 1
        : getUploadProgress(outgoing.loaded, sizes);

      updateConversation(friendId, (conversation) => ({
        ...conversation,
        messages: setMessageUploadProgress(
          setMessageStatus(conversation.messages, clientNonce, "pending"),
          clientNonce,
          roundProgress(progress)
        ),
      }));

      void deliverImages(clientNonce);
    },
    [
      deliver,
      deliverImages,
      findConversation,
      isCoolingDown,
      rejectSend,
      updateConversation,
    ]
  );

  /** Drops a message that was not sent, and tells the server to forget it. */
  const remove = useCallback(
    (friendId: string, clientNonce: string) => {
      const message = findConversation(friendId)?.messages.find(
        (current) =>
          current.clientNonce === clientNonce && current.seq === undefined
      );
      if (message?.status !== "failed" && message?.status !== "blocked") {
        return;
      }

      outgoingRef.current.delete(clientNonce);
      stopPendingCheck(clientNonce);
      revokeLocalCopies(message.attachments);

      updateConversation(friendId, (conversation) => ({
        ...conversation,
        messages: removeUnsentMessage(conversation.messages, clientNonce),
      }));

      // Not found means the server never stored it.
      if (message.attachments?.length) {
        electron.hydraApi
          .delete(chatPath(friendId, `pending/${clientNonce}`))
          .catch(() => {});
      }
    },
    [findConversation, stopPendingCheck, updateConversation]
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
      const { settled, isFailed, error } = await sendReactionTargets(
        targets,
        key,
        friendId,
        seq
      );
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
          isFailed && isNotFriendsError(error) ? false : conversation.canSend,
        messages: updateMessageReactions(conversation.messages, seq, settle),
      }));

      if (isFailed) {
        setReactionError({
          friendId,
          kind: isRateLimitedError(error) ? "rate_limited" : "failed",
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
        if (incoming.fromMe) {
          outgoingRef.current.delete(incoming.clientNonce);
          stopPendingCheck(incoming.clientNonce);
        }
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

    const unsubscribeVisibility = electron.onChatMessageVisibility(
      ({ friendId, seq, hidden }) => {
        if (!findConversation(friendId)) return;

        const key = `${friendId}:${seq}`;
        if (hidden) {
          hiddenAtRef.current.set(key, Date.now());
          updateConversation(friendId, (conversation) => ({
            ...conversation,
            // A removed message can't be replied to.
            replyToSeq:
              conversation.replyToSeq === seq ? null : conversation.replyToSeq,
            messages: setMessageVisibility(conversation.messages, seq, null),
          }));
          return;
        }

        hiddenAtRef.current.delete(key);
        void restoreMessage(friendId, seq);
      }
    );

    const unsubscribeRejected = electron.onChatMessageRejected(
      ({ friendId, clientNonce, reason }) => {
        stopPendingCheck(clientNonce);
        if (reason === "blocked") outgoingRef.current.delete(clientNonce);
        if (!findConversation(friendId)) return;

        updateConversation(friendId, (conversation) => ({
          ...conversation,
          messages: setMessageStatus(
            conversation.messages,
            clientNonce,
            reason
          ),
        }));
      }
    );

    const unsubscribeUploadProgress = electron.onChatAttachmentUploadProgress(
      ({ uploadId, loaded }) => {
        const { clientNonce, index } = fromUploadId(uploadId);
        const outgoing = outgoingRef.current.get(clientNonce);
        if (!outgoing || !(index in outgoing.loaded)) return;

        outgoing.loaded[index] = loaded;
        const progress = roundProgress(
          getUploadProgress(
            outgoing.loaded,
            outgoing.files.map((file) => file.blob.size)
          )
        );

        updateConversation(outgoing.friendId, (conversation) => ({
          ...conversation,
          messages: setMessageUploadProgress(
            conversation.messages,
            clientNonce,
            progress
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
      unsubscribeVisibility();
      unsubscribeRejected();
      unsubscribeUploadProgress();
      unsubscribeResync();
      unsubscribeUnread();
    };
  }, [
    findConversation,
    loadNewerThan,
    restoreMessage,
    resyncConversation,
    stopPendingCheck,
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

  /** Frees a closed conversation's local images and unsent uploads. */
  const forgetConversation = useCallback(
    (friendId: string, messages: ChatMessage[]) => {
      for (const message of messages) {
        revokeLocalCopies(message.attachments);
        stopPendingCheck(message.clientNonce);
      }
      for (const [clientNonce, outgoing] of outgoingRef.current) {
        if (outgoing.friendId === friendId) {
          outgoingRef.current.delete(clientNonce);
        }
      }
    },
    [stopPendingCheck]
  );

  return {
    send,
    retry,
    remove,
    forgetConversation,
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
