import {
  Fragment,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { useTranslation } from "react-i18next";
import type { TFunction } from "i18next";
import {
  AlertIcon,
  ArrowDownIcon,
  CircleSlashIcon,
  ReplyIcon,
  ReportIcon,
  SmileyIcon,
  XIcon,
} from "@primer/octicons-react";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import cn from "classnames";

import { ContextMenu, type ContextMenuItemData } from "@renderer/components";

import { LARGE_EMOJI_MAX_COUNT, countEmojiOnly } from "./chat-emoji";
import {
  ChatEmojiPicker,
  rememberEmoji,
  rememberReaction,
} from "./chat-emoji-picker";
import {
  groupChatMessages,
  type ChatAttachment,
  type ChatMessage,
  type ChatMessageReply,
} from "./chat-message-groups";
import { ChatImageLightbox } from "./chat-image-lightbox";
import { ChatLeavingModal } from "./chat-leaving-modal";
import {
  ChatMessageImages,
  ChatMessageImagesStatus,
} from "./chat-message-images";
import { ChatReactionBar, ChatReactionPills } from "./chat-message-reactions";
import { ChatMessageText } from "./chat-message-text";
import { getMyReaction, toReactionPills } from "./chat-reactions";
import { CHAT_REPORT_EASE_OUT, ChatReportCheck } from "./chat-report-check";
import { ChatReportModal } from "./chat-report-modal";
import type { ChatReportReason } from "./chat-reports";
import { ChatScrollbar } from "./chat-scrollbar";
import {
  countFriendMessagesAfter,
  findFirstFriendMessageAfter,
} from "./chat-state";
import { isTrustedLink } from "./chat-trusted-links";

const electron = globalThis.electron as Electron;

export interface ChatMessageListProps {
  friendId: string;
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
  /** Drops a message that was not sent. */
  onRemove: (clientNonce: string) => void;
  onLoadOlder: () => void;
  onLoadThrough: (seq: number) => Promise<boolean>;
}

/** Older history starts loading this close to the top of the list. */
const LOAD_OLDER_THRESHOLD_PX = 120;
/** Scrolled farther than this from the newest message shows the jump button. */
const JUMP_TO_LATEST_THRESHOLD_PX = 200;
const MAX_NEW_MESSAGES_SHOWN = 99;
const FLASH_DURATION_MS = 1_600;
const REPORT_SENT_DURATION_MS = 3_000;

// The report confirmation springs up out of a blur and sinks back into one.
const TOAST_SPRING = {
  type: "spring",
  stiffness: 420,
  damping: 34,
  mass: 0.75,
} as const;
const TOAST_EXIT_SECONDS = 0.18;
const TOAST_ICON_DELAY_SECONDS = 0.06;
const TOAST_REDUCED_MOTION_SECONDS = 0.15;
const TOAST_CHECK_DELAY_SECONDS = 0.16;
const TOAST_HIDDEN = { opacity: 0, y: 22, scale: 0.96, filter: "blur(10px)" };
const TOAST_SHOWN = { opacity: 1, y: 0, scale: 1, filter: "blur(0px)" };
const TOAST_EXIT = {
  opacity: 0,
  y: 8,
  scale: 0.96,
  filter: "blur(8px)",
  transition: { duration: TOAST_EXIT_SECONDS, ease: CHAT_REPORT_EASE_OUT },
};
const TOAST_ICON_SPRING = {
  type: "spring",
  stiffness: 500,
  damping: 28,
  delay: TOAST_ICON_DELAY_SECONDS,
} as const;
/** Room the quick reaction bar needs above a message before it opens below. */
const REACTION_BAR_CLEARANCE_PX = 56;

const isSameDay = (a: Date, b: Date) => a.toDateString() === b.toDateString();

const prefersReducedMotion = () =>
  window.matchMedia("(prefers-reduced-motion: reduce)").matches;

const countNewMessages = (
  messages: ChatMessage[],
  awayFromId: string | null
) => (awayFromId === null ? 0 : countFriendMessagesAfter(messages, awayFromId));

const findFirstNewId = (messages: ChatMessage[], newSinceId: string | null) =>
  newSinceId === null
    ? null
    : (findFirstFriendMessageAfter(messages, newSinceId)?.id ?? null);

interface OpenImage {
  messageId: string;
  attachmentId: string;
}

/** The open image, or null once its message is gone or removed. */
const findOpenImage = (messages: ChatMessage[], open: OpenImage | null) => {
  if (!open) return null;
  const message = messages.find((current) => current.id === open.messageId);
  if (!message || message.isHidden) return null;
  const attachment = message.attachments?.find(
    (current) => current.id === open.attachmentId
  );
  const src = attachment?.localUrl ?? attachment?.url;
  return src ? { message, src } : null;
};

const getQuotedText = (
  quoted: NonNullable<ChatMessageReply["quoted"]>,
  t: TFunction<"chat_window">
) => {
  if (quoted.isHidden) return t("message_removed");
  if (quoted.text) return quoted.text;
  return quoted.attachmentCount
    ? t("quoted_images", { count: quoted.attachmentCount })
    : "";
};

const getJumpLabel = (newMessageCount: number, t: TFunction<"chat_window">) =>
  newMessageCount > 0
    ? t("jump_to_new_messages", { count: newMessageCount })
    : t("jump_to_latest");

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
      <span
        className={cn("chat-window__message-quote-text", {
          "chat-window__message-quote-text--removed": reply.quoted.isHidden,
        })}
      >
        {getQuotedText(reply.quoted, t)}
      </span>
    </button>
  );
}

export function ChatMessageList({
  friendId,
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
  onRemove,
  onLoadOlder,
  onLoadThrough,
}: Readonly<ChatMessageListProps>) {
  const { t, i18n } = useTranslation("chat_window");

  // Spoiler images this viewer uncovered, by attachment id.
  const [revealedIds, setRevealedIds] = useState<ReadonlySet<string>>(
    () => new Set()
  );
  const [lightbox, setLightbox] = useState<OpenImage | null>(null);
  const revealImage = useCallback(
    (attachment: ChatAttachment) =>
      setRevealedIds((current) => new Set([...current, attachment.id])),
    []
  );

  const scrollRef = useRef<HTMLDivElement>(null);
  const dayDividerRefs = useRef(new Map<string, HTMLDivElement>());
  const messageRefs = useRef(new Map<number, HTMLDivElement>());

  const [flashSeq, setFlashSeq] = useState<number | null>(null);
  // A quoted message that is still loading from older history.
  const [pendingJumpSeq, setPendingJumpSeq] = useState<number | null>(null);
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

  // The message whose right-click menu is open, and where it opened.
  const [menu, setMenu] = useState<{
    seq: number;
    position: { x: number; y: number };
  } | null>(null);
  const [reportSeq, setReportSeq] = useState<number | null>(null);
  // Bumped for each sent report, so the confirmation plays again.
  const [reportSentId, setReportSentId] = useState<number | null>(null);
  const shouldReduceMotion = useReducedMotion();

  // While scrolled away from the newest message: the newest message at that
  // moment. Whatever the friend sends after it counts as new.
  const [awayFromId, setAwayFromId] = useState<string | null>(null);
  const newMessageCount = countNewMessages(messages, awayFromId);

  // Where the "New messages" divider goes from. Unlike `awayFromId` it stays
  // once the user is back at the bottom, until they reply.
  const [newSinceId, setNewSinceId] = useState<string | null>(null);
  const firstNewId = findFirstNewId(messages, newSinceId);

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
    if (emoji !== mine) {
      rememberEmoji(emoji);
      rememberReaction(emoji);
    }
    onReact(message.seq, emoji === mine ? null : emoji);
  };

  const reactionPickerMessage =
    reactionPickerSeq === null
      ? null
      : (messages.find((message) => message.seq === reactionPickerSeq) ?? null);

  // Only stored messages have a seq to reply, react to or report.
  const canAct = (message: ChatMessage) =>
    canReply &&
    message.seq !== undefined &&
    message.status === "sent" &&
    !message.isHidden;

  // Reports work after an unfriend or block, but only on the friend's messages.
  const canReport = (message: ChatMessage) =>
    !message.fromMe && message.seq !== undefined && !message.isHidden;

  const openMenu = (event: React.MouseEvent, message: ChatMessage) => {
    const target = event.target as Element;
    const isOnMessage = target.closest(
      ".chat-window__message-body, .chat-window__message-actions"
    );
    if (
      !isOnMessage ||
      message.seq === undefined ||
      (!canAct(message) && !canReport(message))
    ) {
      return;
    }

    event.preventDefault();
    setReactionBar(null);
    setMenu({
      seq: message.seq,
      position: { x: event.clientX, y: event.clientY },
    });
  };

  const closeMenu = useCallback(() => setMenu(null), []);

  const openReactionBar = (seq: number) => {
    const button = messageRefs.current
      .get(seq)
      ?.querySelector<HTMLButtonElement>(".chat-window__message-action");
    if (button) toggleReactionBar(seq, button);
  };

  const getMenuItems = (message: ChatMessage): ContextMenuItemData[] => {
    const { seq } = message;
    if (seq === undefined) return [];

    const items: ContextMenuItemData[] = [];

    if (canAct(message)) {
      items.push(
        {
          id: "react",
          label: t("add_reaction"),
          icon: <SmileyIcon size={16} />,
          onClick: () => openReactionBar(seq),
        },
        {
          id: "reply",
          label: t("reply"),
          icon: <ReplyIcon size={16} />,
          onClick: () => onReply(message),
        }
      );
    }

    // The menu draws its own line above danger items.
    if (canReport(message)) {
      items.push({
        id: "report",
        label: t("report_message"),
        icon: <ReportIcon size={16} />,
        danger: true,
        onClick: () => setReportSeq(seq),
      });
    }

    return items;
  };

  const menuMessage =
    menu === null
      ? null
      : (messages.find((message) => message.seq === menu.seq) ?? null);
  // Empty once the message is removed while the menu is open.
  const menuItems = menuMessage ? getMenuItems(menuMessage) : [];

  const submitReport = async (
    seq: number,
    reason: ChatReportReason,
    description: string
  ) => {
    // The server keeps earlier messages with it as context, and reporting
    // the same message again changes nothing.
    const details = description.trim();
    await electron.hydraApi.post(
      `/profile/chats/${friendId}/messages/${seq}/report`,
      { data: { reason, ...(details ? { description: details } : {}) } }
    );
  };

  // The confirmation comes up once the dialog is gone.
  const closeReport = (isSent: boolean) => {
    setReportSeq(null);
    if (isSent) setReportSentId((id) => (id ?? 0) + 1);
  };

  useEffect(() => {
    if (reportSentId === null) return;

    const timer = setTimeout(
      () => setReportSentId(null),
      REPORT_SENT_DURATION_MS
    );
    return () => clearTimeout(timer);
  }, [reportSentId]);

  const openLink = (url: string) => {
    if (isTrustedLink(url)) {
      void electron.openExternal(url);
      return;
    }

    setLeavingUrl(url);
  };

  const openImage = (message: ChatMessage, attachment: ChatAttachment) => {
    if (!attachment.localUrl && !attachment.url) return;
    setLightbox({ messageId: message.id, attachmentId: attachment.id });
  };

  const openImageView = findOpenImage(messages, lightbox);
  const getImageCaption = (message: ChatMessage) =>
    `${message.fromMe ? t("you") : friendName} · ${timeFormat.format(
      new Date(message.createdAt)
    )}`;
  useEffect(() => {
    if (lightbox && !openImageView) setLightbox(null);
  }, [lightbox, openImageView]);

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

  const jumpLabel = getJumpLabel(newMessageCount, t);

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
                        const isReactionBarOpen =
                          seq !== undefined && reactionBar?.seq === seq;
                        const isReacting =
                          isReactionBarOpen ||
                          (seq !== undefined && reactionPickerSeq === seq);
                        const hasImages = Boolean(message.attachments?.length);
                        const hasBubble =
                          message.text.length > 0 || Boolean(message.replyTo);
                        const isHighlighted =
                          seq !== undefined &&
                          (seq === replyToSeq || isReacting);
                        const isFlashing =
                          seq !== undefined && seq === flashSeq;
                        // Replies keep their bubble to hold the quote, and
                        // captions to sit under their images.
                        const emojiCount =
                          message.replyTo || hasImages
                            ? 0
                            : countEmojiOnly(message.text);
                        const pills = toReactionPills(message.reactions ?? []);
                        const align = group.fromMe ? "end" : "start";

                        const actions = seq !== undefined &&
                          canAct(message) && (
                            <div
                              className={cn("chat-window__message-actions", {
                                "chat-window__message-actions--visible":
                                  isReacting,
                              })}
                            >
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
                            onContextMenu={(event) => openMenu(event, message)}
                            className={cn("chat-window__message-row", {
                              "chat-window__message-row--enter":
                                !isStatic(message),
                              "chat-window__message-row--pending":
                                message.status === "pending" ||
                                message.status === "checking",
                              "chat-window__message-row--failed":
                                message.status === "failed" && !hasImages,
                              "chat-window__message-row--unsent":
                                hasImages &&
                                (message.status === "failed" ||
                                  message.status === "blocked"),
                            })}
                          >
                            {/* Actions sit on the side away from the sender. */}
                            {group.fromMe && actions}
                            <div className="chat-window__message-body">
                              {hasImages && (
                                <ChatMessageImages
                                  message={message}
                                  isCaptioned={hasBubble && !message.isHidden}
                                  isHighlighted={isHighlighted}
                                  isFlashing={isFlashing}
                                  revealedIds={revealedIds}
                                  onReveal={revealImage}
                                  onOpen={(attachment) =>
                                    openImage(message, attachment)
                                  }
                                  onRetry={() => onRetry(message.clientNonce)}
                                />
                              )}
                              {message.isHidden && !hasImages && (
                                <p className="chat-window__message chat-window__message--removed">
                                  <CircleSlashIcon size={14} />
                                  {t("message_removed")}
                                </p>
                              )}
                              {!message.isHidden && hasBubble && (
                                <p
                                  className={cn("chat-window__message", {
                                    "chat-window__message--reply":
                                      message.replyTo,
                                    "chat-window__message--emoji":
                                      emojiCount > 0,
                                    "chat-window__message--emoji-small":
                                      emojiCount > LARGE_EMOJI_MAX_COUNT,
                                    "chat-window__message--replying":
                                      isHighlighted,
                                    "chat-window__message--flash": isFlashing,
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
                              )}
                              {seq !== undefined && !message.isHidden && (
                                <ChatReactionPills
                                  pills={pills}
                                  friendName={friendName}
                                  align={align}
                                  isDetached={emojiCount > 0}
                                  canReact={canReply}
                                  onToggle={(pill) =>
                                    reactTo(message, pill.emoji)
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
                            {message.status === "failed" && !hasImages && (
                              <button
                                type="button"
                                className="chat-window__message-retry"
                                onClick={() => onRetry(message.clientNonce)}
                              >
                                <AlertIcon size={12} />
                                {t("send_failed")} · {t("retry")}
                              </button>
                            )}
                            {hasImages && message.status !== "sent" && (
                              <ChatMessageImagesStatus
                                message={message}
                                onRetry={() => onRetry(message.clientNonce)}
                                onRemove={() => onRemove(message.clientNonce)}
                              />
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

      {openImageView && (
        <ChatImageLightbox
          src={openImageView.src}
          caption={getImageCaption(openImageView.message)}
          onClose={() => setLightbox(null)}
        />
      )}

      {leavingUrl && (
        <ChatLeavingModal
          url={leavingUrl}
          onClose={() => setLeavingUrl(null)}
        />
      )}

      {menu && menuItems.length > 0 && (
        <ContextMenu
          visible
          items={menuItems}
          position={menu.position}
          onClose={closeMenu}
          className="chat-window__message-menu"
        />
      )}

      {reportSeq !== null && (
        <ChatReportModal
          onSubmit={(reason, description) =>
            submitReport(reportSeq, reason, description)
          }
          onClose={closeReport}
        />
      )}

      <AnimatePresence>
        {reportSentId !== null && (
          <motion.div
            key={reportSentId}
            className="chat-window__toast"
            role="status"
            initial={shouldReduceMotion ? { opacity: 0 } : TOAST_HIDDEN}
            animate={TOAST_SHOWN}
            exit={shouldReduceMotion ? { opacity: 0 } : TOAST_EXIT}
            transition={
              shouldReduceMotion
                ? { duration: TOAST_REDUCED_MOTION_SECONDS }
                : TOAST_SPRING
            }
          >
            <motion.span
              className="chat-window__toast-icon"
              aria-hidden="true"
              initial={shouldReduceMotion ? false : { scale: 0.6, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              transition={TOAST_ICON_SPRING}
            >
              <ChatReportCheck size={14} delay={TOAST_CHECK_DELAY_SECONDS} />
            </motion.span>
            <span className="chat-window__toast-text">
              <span className="chat-window__toast-title">
                {t("report_sent")}
              </span>
              <span className="chat-window__toast-description">
                {t("report_sent_description")}
              </span>
            </span>
            <button
              type="button"
              className="chat-window__toast-dismiss"
              onClick={() => setReportSentId(null)}
              aria-label={t("dismiss")}
            >
              <XIcon size={14} />
            </button>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
