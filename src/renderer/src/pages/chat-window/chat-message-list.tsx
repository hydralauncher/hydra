import {
  Fragment,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { useTranslation } from "react-i18next";
import {
  AlertIcon,
  ArrowDownIcon,
  CheckIcon,
  CopyIcon,
  ReplyIcon,
  SmileyIcon,
} from "@primer/octicons-react";
import cn from "classnames";

import { LARGE_EMOJI_MAX_COUNT, countEmojiOnly } from "./chat-emoji";
import { ChatEmojiPicker, rememberEmoji } from "./chat-emoji-picker";
import {
  groupChatMessages,
  type ChatMessage,
  type ChatMessageReply,
} from "./chat-message-groups";
import { ChatLeavingModal } from "./chat-leaving-modal";
import { ChatReactionBar, ChatReactionPills } from "./chat-message-reactions";
import { ChatMessageText } from "./chat-message-text";
import { getMyReaction, toReactionPills } from "./chat-reactions";
import { ChatScrollbar } from "./chat-scrollbar";
import {
  countFriendMessagesAfter,
  findFirstFriendMessageAfter,
} from "./chat-state";
import { isTrustedLink } from "./chat-trusted-links";

const electron = globalThis.electron as Electron;

export interface ChatMessageListProps {
  messages: ChatMessage[];
  /** Messages that render without the entrance animation. */
  initialMessageIds: Set<string>;
  hasMoreBefore: boolean;
  friendName: string;
  /** False once the users can no longer message each other: no replies or reactions. */
  canReply: boolean;
  /** The message the composer is replying to, highlighted in the list. */
  replyToSeq: number | null;
  /** A new object scrolls to and flashes the message with that seq. */
  revealSeq: { seq: number } | null;
  onReply: (message: ChatMessage) => void;
  /** Sets the user's reaction on the message with `seq`; null removes it. */
  onReact: (seq: number, emoji: string | null) => void;
  onRetry: (clientNonce: string) => void;
  onLoadOlder: () => void;
  onLoadThrough: (seq: number) => Promise<boolean>;
}

/** Older history starts loading this close to the top of the list. */
const LOAD_OLDER_THRESHOLD_PX = 120;
/** Scrolled farther than this from the newest message shows the jump button. */
const JUMP_TO_LATEST_THRESHOLD_PX = 200;
const MAX_NEW_MESSAGES_SHOWN = 99;
const FLASH_DURATION_MS = 1_600;
const COPIED_DURATION_MS = 1_500;
/** Room the quick reaction bar needs above a message before it opens below. */
const REACTION_BAR_CLEARANCE_PX = 56;

const isSameDay = (a: Date, b: Date) => a.toDateString() === b.toDateString();

const prefersReducedMotion = () =>
  window.matchMedia("(prefers-reduced-motion: reduce)").matches;

interface ChatMessageQuoteProps {
  reply: ChatMessageReply;
  friendName: string;
  onJump: (seq: number) => void;
}

function ChatMessageQuote({
  reply,
  friendName,
  onJump,
}: Readonly<ChatMessageQuoteProps>) {
  const { t } = useTranslation("chat_window");

  if (!reply.quoted) {
    return (
      <span className="chat-window__message-quote chat-window__message-quote--unavailable">
        {t("reply_unavailable")}
      </span>
    );
  }

  return (
    <button
      type="button"
      className="chat-window__message-quote"
      onClick={() => onJump(reply.seq)}
      title={t("jump_to_original")}
    >
      <span className="chat-window__message-quote-name">
        <ReplyIcon size={12} />
        {reply.quoted.fromMe ? t("you") : friendName}
      </span>
      <span className="chat-window__message-quote-text">
        {reply.quoted.text}
      </span>
    </button>
  );
}

export function ChatMessageList({
  messages,
  initialMessageIds,
  hasMoreBefore,
  friendName,
  canReply,
  replyToSeq,
  revealSeq,
  onReply,
  onReact,
  onRetry,
  onLoadOlder,
  onLoadThrough,
}: Readonly<ChatMessageListProps>) {
  const { t, i18n } = useTranslation("chat_window");

  const scrollRef = useRef<HTMLDivElement>(null);
  const dayDividerRefs = useRef(new Map<string, HTMLDivElement>());
  const messageRefs = useRef(new Map<number, HTMLDivElement>());

  const [flashSeq, setFlashSeq] = useState<number | null>(null);
  // A quoted message that is still loading from older history.
  const [pendingJumpSeq, setPendingJumpSeq] = useState<number | null>(null);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  // A link waiting for the user to confirm leaving Hydra.
  const [leavingUrl, setLeavingUrl] = useState<string | null>(null);

  // The message whose quick reaction bar or full emoji picker is open, and
  // the button that opened it.
  const [reactionBar, setReactionBar] = useState<{
    seq: number;
    placement: "above" | "below";
  } | null>(null);
  const [reactionPickerSeq, setReactionPickerSeq] = useState<number | null>(
    null
  );
  const reactionAnchorRef = useRef<HTMLButtonElement | null>(null);

  // While scrolled away from the newest message: the newest message at that
  // moment. Whatever the friend sends after it counts as new.
  const [awayFromId, setAwayFromId] = useState<string | null>(null);
  const newMessageCount =
    awayFromId === null ? 0 : countFriendMessagesAfter(messages, awayFromId);

  // Where the "New messages" divider goes from. Unlike `awayFromId` it stays
  // once the user is back at the bottom, until they reply.
  const [newSinceId, setNewSinceId] = useState<string | null>(null);
  const firstNewId =
    newSinceId === null
      ? null
      : (findFirstFriendMessageAfter(messages, newSinceId)?.id ?? null);

  // Keeps the jump button on screen while it animates out, with the count it
  // had when the user got back to the bottom.
  const [leavingJump, setLeavingJump] = useState<{ count: number } | null>(
    null
  );

  // The day of the topmost messages, floated over the list while scrolled up.
  const [stickyDayKey, setStickyDayKey] = useState<string | null>(null);

  const days = useMemo(
    () => groupChatMessages(messages, firstNewId),
    [messages, firstNewId]
  );
  const stickyDay =
    awayFromId === null ? null : days.find((day) => day.key === stickyDayKey);

  const timeFormat = useMemo(
    () =>
      new Intl.DateTimeFormat(i18n.language, {
        hour: "2-digit",
        minute: "2-digit",
      }),
    [i18n.language]
  );

  const dayFormat = useMemo(
    () =>
      new Intl.DateTimeFormat(i18n.language, {
        month: "short",
        day: "numeric",
      }),
    [i18n.language]
  );

  const isStatic = (message: ChatMessage) =>
    initialMessageIds.has(message.id) || Boolean(message.fromHistory);

  const updateStickyDay = (viewport: HTMLElement) => {
    const viewportTop = viewport.getBoundingClientRect().top;

    // The last day whose divider has scrolled out of view above.
    let dayKey: string | null = null;
    for (const day of days) {
      const divider = dayDividerRefs.current.get(day.key);
      if (divider && divider.getBoundingClientRect().bottom <= viewportTop) {
        dayKey = day.key;
      }
    }

    if (dayKey !== stickyDayKey) setStickyDayKey(dayKey);
  };

  const setAway = (isAway: boolean) => {
    const latestId = messages.at(-1)?.id ?? null;
    setAwayFromId(isAway ? latestId : null);

    if (isAway) {
      setLeavingJump(null);
      // A divider still in the list keeps its place.
      if (firstNewId === null) setNewSinceId(latestId);
      return;
    }

    // Without motion there is no exit animation to wait for.
    if (!prefersReducedMotion()) {
      setLeavingJump({ count: newMessageCount });
    }
    // Nothing arrived while away, so later messages are seen live.
    if (firstNewId === null) setNewSinceId(null);
  };

  // column-reverse makes scrollTop 0 at the bottom and negative going up.
  const handleScroll = (event: React.UIEvent<HTMLDivElement>) => {
    const { scrollHeight, clientHeight, scrollTop } = event.currentTarget;

    const isAway = -scrollTop > JUMP_TO_LATEST_THRESHOLD_PX;
    if (isAway !== (awayFromId !== null)) setAway(isAway);

    updateStickyDay(event.currentTarget);

    if (
      hasMoreBefore &&
      scrollHeight - clientHeight + scrollTop < LOAD_OLDER_THRESHOLD_PX
    ) {
      onLoadOlder();
    }
  };

  const revealMessage = useCallback((seq: number) => {
    const element = messageRefs.current.get(seq);
    if (!element) return false;

    element.scrollIntoView({
      block: "center",
      behavior: prefersReducedMotion() ? "auto" : "smooth",
    });
    setFlashSeq(seq);
    return true;
  }, []);

  const jumpToMessage = (seq: number) => {
    if (revealMessage(seq)) return;

    setPendingJumpSeq(seq);
    void onLoadThrough(seq).then((isLoaded) => {
      if (!isLoaded) {
        setPendingJumpSeq((current) => (current === seq ? null : current));
      }
    });
  };

  // The jump completes once the older history holding the message renders.
  useEffect(() => {
    if (pendingJumpSeq !== null && revealMessage(pendingJumpSeq)) {
      setPendingJumpSeq(null);
    }
  }, [messages, pendingJumpSeq, revealMessage]);

  useEffect(() => {
    if (revealSeq) revealMessage(revealSeq.seq);
  }, [revealSeq, revealMessage]);

  useEffect(() => {
    if (flashSeq === null) return;

    const timer = setTimeout(() => setFlashSeq(null), FLASH_DURATION_MS);
    return () => clearTimeout(timer);
  }, [flashSeq]);

  useEffect(() => {
    if (copiedId === null) return;

    const timer = setTimeout(() => setCopiedId(null), COPIED_DURATION_MS);
    return () => clearTimeout(timer);
  }, [copiedId]);

  const copyText = (message: ChatMessage) => {
    navigator.clipboard
      .writeText(message.text)
      .then(() => setCopiedId(message.id))
      .catch(() => {});
  };

  const toggleReactionBar = (seq: number, button: HTMLButtonElement) => {
    if (reactionBar?.seq === seq) {
      setReactionBar(null);
      return;
    }

    const body = button
      .closest(".chat-window__message-row")
      ?.querySelector(".chat-window__message-body");
    const viewportTop = scrollRef.current?.getBoundingClientRect().top ?? 0;
    const roomAbove = (body?.getBoundingClientRect().top ?? 0) - viewportTop;

    reactionAnchorRef.current = button;
    setReactionPickerSeq(null);
    setReactionBar({
      seq,
      placement: roomAbove < REACTION_BAR_CLEARANCE_PX ? "below" : "above",
    });
  };

  const closeReactionBar = useCallback(() => setReactionBar(null), []);

  const closeReactionPicker = useCallback(() => {
    setReactionPickerSeq(null);
    reactionAnchorRef.current?.focus();
  }, []);

  // Picking the reaction the user already has takes it back.
  const reactTo = (message: ChatMessage, emoji: string) => {
    if (message.seq === undefined) return;

    const mine = getMyReaction(message);
    if (emoji !== mine) rememberEmoji(emoji);
    onReact(message.seq, emoji === mine ? null : emoji);
  };

  const reactionPickerMessage =
    reactionPickerSeq === null
      ? null
      : (messages.find((message) => message.seq === reactionPickerSeq) ?? null);

  const openLink = (url: string) => {
    if (isTrustedLink(url)) {
      void electron.openExternal(url);
      return;
    }

    setLeavingUrl(url);
  };

  const scrollToLatest = useCallback(() => {
    scrollRef.current?.scrollTo({
      top: 0,
      behavior: prefersReducedMotion() ? "auto" : "smooth",
    });
  }, []);

  // Sending a message brings the list back to it, and replying means the
  // new messages were read.
  const newestMessage = messages.at(-1);
  const newestMessageIdRef = useRef(newestMessage?.id);
  useEffect(() => {
    if (!newestMessage || newestMessage.id === newestMessageIdRef.current) {
      return;
    }
    newestMessageIdRef.current = newestMessage.id;

    if (newestMessage.fromMe && newestMessage.status === "pending") {
      setNewSinceId(null);
      scrollToLatest();
    }
  }, [newestMessage, scrollToLatest]);

  const isJumpLeaving = awayFromId === null && leavingJump !== null;
  const jumpCount = isJumpLeaving ? leavingJump.count : newMessageCount;

  const jumpLabel =
    newMessageCount > 0
      ? t("jump_to_new_messages", { count: newMessageCount })
      : t("jump_to_latest");

  const getDayLabel = (date: Date) => {
    const today = new Date();
    const yesterday = new Date();
    yesterday.setDate(today.getDate() - 1);

    if (isSameDay(date, today)) return t("today");
    if (isSameDay(date, yesterday)) return t("yesterday");
    return dayFormat.format(date);
  };

  return (
    <div className="chat-window__messages-viewport">
      {/* column-reverse keeps the scroll pinned to the newest message. */}
      <div
        ref={scrollRef}
        className="chat-window__messages"
        onScroll={handleScroll}
      >
        <div
          className="chat-window__messages-content"
          role="log"
          aria-label={t("messages")}
          aria-live="polite"
        >
          {days.map((day) => (
            <Fragment key={day.key}>
              <div
                ref={(element) => {
                  if (element) dayDividerRefs.current.set(day.key, element);
                  else dayDividerRefs.current.delete(day.key);
                }}
                className="chat-window__day-divider"
              >
                {getDayLabel(day.date)}
              </div>

              {day.groups.map((group) => {
                const lastMessage = group.messages.at(-1);

                return (
                  <Fragment key={group.key}>
                    {group.key === firstNewId && (
                      <div className="chat-window__new-divider">
                        {t("new_messages")}
                      </div>
                    )}
                    <div
                      className={cn("chat-window__message-group", {
                        "chat-window__message-group--mine": group.fromMe,
                      })}
                    >
                      {group.messages.map((message) => {
                        const { seq } = message;
                        const isCopied = copiedId === message.id;
                        const isReactionBarOpen =
                          seq !== undefined && reactionBar?.seq === seq;
                        const isReacting =
                          isReactionBarOpen ||
                          (seq !== undefined && reactionPickerSeq === seq);
                        // Replies keep their bubble to hold the quote.
                        const emojiCount = message.replyTo
                          ? 0
                          : countEmojiOnly(message.text);
                        const pills = toReactionPills(message.reactions ?? []);
                        const align = group.fromMe ? "end" : "start";

                        // Only stored messages have a seq to reply or react to.
                        const actions = seq !== undefined &&
                          message.status === "sent" && (
                            <div
                              className={cn("chat-window__message-actions", {
                                "chat-window__message-actions--visible":
                                  isCopied || isReacting,
                              })}
                            >
                              {canReply && (
                                <button
                                  type="button"
                                  className={cn("chat-window__message-action", {
                                    "chat-window__message-action--active":
                                      isReacting,
                                  })}
                                  onClick={(event) =>
                                    toggleReactionBar(seq, event.currentTarget)
                                  }
                                  aria-label={t("add_reaction")}
                                  aria-expanded={isReactionBarOpen}
                                >
                                  <SmileyIcon size={16} />
                                  <span
                                    className="chat-window__message-action-tooltip"
                                    aria-hidden="true"
                                  >
                                    {t("add_reaction")}
                                  </span>
                                </button>
                              )}
                              {canReply && (
                                <button
                                  type="button"
                                  className="chat-window__message-action"
                                  onClick={() => onReply(message)}
                                  aria-label={t("reply")}
                                >
                                  <ReplyIcon size={16} />
                                  <span
                                    className="chat-window__message-action-tooltip"
                                    aria-hidden="true"
                                  >
                                    {t("reply")}
                                  </span>
                                </button>
                              )}
                              <button
                                type="button"
                                className={cn("chat-window__message-action", {
                                  "chat-window__message-action--copied":
                                    isCopied,
                                })}
                                onClick={() => copyText(message)}
                                aria-label={
                                  isCopied ? t("copied") : t("copy_text")
                                }
                              >
                                {isCopied ? (
                                  <CheckIcon size={16} />
                                ) : (
                                  <CopyIcon size={16} />
                                )}
                                <span
                                  className="chat-window__message-action-tooltip"
                                  aria-hidden="true"
                                >
                                  {isCopied ? t("copied") : t("copy_text")}
                                </span>
                              </button>
                            </div>
                          );

                        return (
                          <div
                            key={message.id}
                            ref={(element) => {
                              if (seq === undefined) return;
                              if (element)
                                messageRefs.current.set(seq, element);
                              else messageRefs.current.delete(seq);
                            }}
                            className={cn("chat-window__message-row", {
                              "chat-window__message-row--enter":
                                !isStatic(message),
                              "chat-window__message-row--pending":
                                message.status === "pending",
                              "chat-window__message-row--failed":
                                message.status === "failed",
                            })}
                          >
                            {/* Actions sit on the side away from the sender. */}
                            {group.fromMe && actions}
                            <div className="chat-window__message-body">
                              <p
                                className={cn("chat-window__message", {
                                  "chat-window__message--reply":
                                    message.replyTo,
                                  "chat-window__message--emoji": emojiCount > 0,
                                  "chat-window__message--emoji-small":
                                    emojiCount > LARGE_EMOJI_MAX_COUNT,
                                  "chat-window__message--replying":
                                    seq !== undefined &&
                                    (seq === replyToSeq || isReacting),
                                  "chat-window__message--flash":
                                    seq !== undefined && seq === flashSeq,
                                })}
                              >
                                {message.replyTo && (
                                  <ChatMessageQuote
                                    reply={message.replyTo}
                                    friendName={friendName}
                                    onJump={jumpToMessage}
                                  />
                                )}
                                <ChatMessageText
                                  text={message.text}
                                  onOpenLink={openLink}
                                />
                              </p>
                              {seq !== undefined && (
                                <ChatReactionPills
                                  pills={pills}
                                  friendName={friendName}
                                  align={align}
                                  isDetached={emojiCount > 0}
                                  canReact={canReply}
                                  onToggle={(pill) =>
                                    onReact(
                                      seq,
                                      pill.fromMe ? null : pill.emoji
                                    )
                                  }
                                />
                              )}
                              {isReactionBarOpen && reactionBar && (
                                <ChatReactionBar
                                  selected={getMyReaction(message)}
                                  placement={reactionBar.placement}
                                  align={align}
                                  anchorRef={reactionAnchorRef}
                                  onPick={(emoji) => {
                                    reactTo(message, emoji);
                                    setReactionBar(null);
                                  }}
                                  onMore={() => {
                                    setReactionBar(null);
                                    setReactionPickerSeq(seq);
                                  }}
                                  onClose={closeReactionBar}
                                />
                              )}
                            </div>
                            {!group.fromMe && actions}
                            {message.status === "failed" && (
                              <button
                                type="button"
                                className="chat-window__message-retry"
                                onClick={() => onRetry(message.clientNonce)}
                              >
                                <AlertIcon size={12} />
                                {t("send_failed")} · {t("retry")}
                              </button>
                            )}
                          </div>
                        );
                      })}
                      {lastMessage && (
                        <time
                          className={cn("chat-window__message-time", {
                            "chat-window__message-time--enter": !isStatic(
                              group.messages[0]
                            ),
                          })}
                          dateTime={lastMessage.createdAt}
                        >
                          {timeFormat.format(new Date(lastMessage.createdAt))}
                        </time>
                      )}
                    </div>
                  </Fragment>
                );
              })}
            </Fragment>
          ))}
        </div>
      </div>

      {stickyDay && (
        <div className="chat-window__sticky-day" aria-hidden="true">
          {getDayLabel(stickyDay.date)}
        </div>
      )}

      <ChatScrollbar scrollRef={scrollRef} />

      {(awayFromId !== null || leavingJump) && (
        <button
          type="button"
          className={cn("chat-window__jump", {
            "chat-window__jump--leaving": isJumpLeaving,
          })}
          onClick={scrollToLatest}
          onAnimationEnd={(event) => {
            if (isJumpLeaving && event.target === event.currentTarget) {
              setLeavingJump(null);
            }
          }}
          title={isJumpLeaving ? undefined : jumpLabel}
          aria-label={jumpLabel}
          aria-hidden={isJumpLeaving || undefined}
          tabIndex={isJumpLeaving ? -1 : undefined}
        >
          <ArrowDownIcon size={16} />
          {jumpCount > 0 && (
            <span className="chat-window__jump-count" aria-hidden="true">
              {jumpCount > MAX_NEW_MESSAGES_SHOWN
                ? `${MAX_NEW_MESSAGES_SHOWN}+`
                : jumpCount}
            </span>
          )}
        </button>
      )}

      {reactionPickerMessage && (
        <ChatEmojiPicker
          label={t("choose_reaction")}
          className={cn(
            "chat-window__emoji-picker--reaction",
            reactionPickerMessage.fromMe
              ? "chat-window__emoji-picker--end"
              : "chat-window__emoji-picker--start"
          )}
          selected={getMyReaction(reactionPickerMessage)}
          anchorRef={reactionAnchorRef}
          onPick={(emoji) => {
            reactTo(reactionPickerMessage, emoji);
            closeReactionPicker();
          }}
          onClose={closeReactionPicker}
        />
      )}

      {leavingUrl && (
        <ChatLeavingModal
          url={leavingUrl}
          onClose={() => setLeavingUrl(null)}
        />
      )}
    </div>
  );
}
