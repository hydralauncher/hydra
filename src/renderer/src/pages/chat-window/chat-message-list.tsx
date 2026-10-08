import { Fragment, useMemo } from "react";
import { useTranslation } from "react-i18next";
import { AlertIcon } from "@primer/octicons-react";
import cn from "classnames";

import { ChatTypingDots } from "./chat-friend-status";
import { groupChatMessages, type ChatMessage } from "./chat-message-groups";

export interface ChatMessageListProps {
  messages: ChatMessage[];
  /** Messages that render without the entrance animation. */
  initialMessageIds: Set<string>;
  isTyping: boolean;
  friendName: string;
  hasMoreBefore: boolean;
  onRetry: (clientNonce: string) => void;
  onLoadOlder: () => void;
}

/** Older history starts loading this close to the top of the list. */
const LOAD_OLDER_THRESHOLD_PX = 120;

const isSameDay = (a: Date, b: Date) => a.toDateString() === b.toDateString();

export function ChatMessageList({
  messages,
  initialMessageIds,
  isTyping,
  friendName,
  hasMoreBefore,
  onRetry,
  onLoadOlder,
}: ChatMessageListProps) {
  const { t, i18n } = useTranslation("chat_window");

  const days = useMemo(() => groupChatMessages(messages), [messages]);

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

  // column-reverse makes scrollTop 0 at the bottom and negative going up.
  const handleScroll = (event: React.UIEvent<HTMLDivElement>) => {
    if (!hasMoreBefore) return;
    const { scrollHeight, clientHeight, scrollTop } = event.currentTarget;
    if (scrollHeight - clientHeight + scrollTop < LOAD_OLDER_THRESHOLD_PX) {
      onLoadOlder();
    }
  };

  const getDayLabel = (date: Date) => {
    const today = new Date();
    const yesterday = new Date();
    yesterday.setDate(today.getDate() - 1);

    if (isSameDay(date, today)) return t("today");
    if (isSameDay(date, yesterday)) return t("yesterday");
    return dayFormat.format(date);
  };

  return (
    // column-reverse keeps the scroll pinned to the newest message.
    <div className="chat-window__messages" onScroll={handleScroll}>
      <div
        className="chat-window__messages-content"
        role="log"
        aria-label={t("messages")}
        aria-live="polite"
      >
        {days.map((day) => (
          <Fragment key={day.key}>
            <div className="chat-window__day-divider">
              {getDayLabel(day.date)}
            </div>

            {day.groups.map((group) => {
              const lastMessage = group.messages[group.messages.length - 1];

              return (
                <div
                  key={group.key}
                  className={cn("chat-window__message-group", {
                    "chat-window__message-group--mine": group.fromMe,
                  })}
                >
                  {group.messages.map((message) => (
                    <div
                      key={message.id}
                      className={cn("chat-window__message-row", {
                        "chat-window__message-row--enter": !isStatic(message),
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
              );
            })}
          </Fragment>
        ))}

        {isTyping && (
          <div className="chat-window__typing" role="status">
            <span className="chat-window__typing-bubble">
              <ChatTypingDots />
            </span>
            <span className="chat-window__typing-label">
              {t("typing", { name: friendName })}
            </span>
          </div>
        )}
      </div>
    </div>
  );
}
