import {
  Fragment,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { useTranslation } from "react-i18next";
import { AlertIcon, ArrowDownIcon } from "@primer/octicons-react";
import cn from "classnames";

import { groupChatMessages, type ChatMessage } from "./chat-message-groups";
import { ChatScrollbar } from "./chat-scrollbar";
import {
  countFriendMessagesAfter,
  findFirstFriendMessageAfter,
} from "./chat-state";

export interface ChatMessageListProps {
  messages: ChatMessage[];
  /** Messages that render without the entrance animation. */
  initialMessageIds: Set<string>;
  hasMoreBefore: boolean;
  onRetry: (clientNonce: string) => void;
  onLoadOlder: () => void;
}

/** Older history starts loading this close to the top of the list. */
const LOAD_OLDER_THRESHOLD_PX = 120;
/** Scrolled farther than this from the newest message shows the jump button. */
const JUMP_TO_LATEST_THRESHOLD_PX = 200;
const MAX_NEW_MESSAGES_SHOWN = 99;

const isSameDay = (a: Date, b: Date) => a.toDateString() === b.toDateString();

const prefersReducedMotion = () =>
  window.matchMedia("(prefers-reduced-motion: reduce)").matches;

export function ChatMessageList({
  messages,
  initialMessageIds,
  hasMoreBefore,
  onRetry,
  onLoadOlder,
}: ChatMessageListProps) {
  const { t, i18n } = useTranslation("chat_window");

  const scrollRef = useRef<HTMLDivElement>(null);
  const dayDividerRefs = useRef(new Map<string, HTMLDivElement>());

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

  // column-reverse makes scrollTop 0 at the bottom and negative going up.
  const handleScroll = (event: React.UIEvent<HTMLDivElement>) => {
    const { scrollHeight, clientHeight, scrollTop } = event.currentTarget;

    const isAway = -scrollTop > JUMP_TO_LATEST_THRESHOLD_PX;
    if (isAway !== (awayFromId !== null)) {
      const latestId = messages[messages.length - 1]?.id ?? null;
      setAwayFromId(isAway ? latestId : null);

      if (isAway) {
        setLeavingJump(null);
        // A divider still in the list keeps its place.
        if (firstNewId === null) setNewSinceId(latestId);
      } else {
        // Without motion there is no exit animation to wait for.
        if (!prefersReducedMotion()) {
          setLeavingJump({ count: newMessageCount });
        }
        // Nothing arrived while away, so later messages are seen live.
        if (firstNewId === null) setNewSinceId(null);
      }
    }

    updateStickyDay(event.currentTarget);

    if (
      hasMoreBefore &&
      scrollHeight - clientHeight + scrollTop < LOAD_OLDER_THRESHOLD_PX
    ) {
      onLoadOlder();
    }
  };

  const scrollToLatest = useCallback(() => {
    scrollRef.current?.scrollTo({
      top: 0,
      behavior: prefersReducedMotion() ? "auto" : "smooth",
    });
  }, []);

  // Sending a message brings the list back to it, and replying means the
  // new messages were read.
  const newestMessage = messages[messages.length - 1];
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
                const lastMessage = group.messages[group.messages.length - 1];

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
                      {group.messages.map((message) => (
                        <div
                          key={message.id}
                          className={cn("chat-window__message-row", {
                            "chat-window__message-row--enter":
                              !isStatic(message),
                            "chat-window__message-row--pending":
                              message.status === "pending",
                            "chat-window__message-row--failed":
                              message.status === "failed",
                          })}
                        >
                          <p className="chat-window__message">{message.text}</p>
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
                      ))}
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
    </div>
  );
}
