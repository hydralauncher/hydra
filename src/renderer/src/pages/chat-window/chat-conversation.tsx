import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { AlertFillIcon, PaperAirplaneIcon } from "@primer/octicons-react";
import cn from "classnames";

import { ChatEmptyIcon } from "./chat-empty-icon";
import { ChatTypingDots } from "./chat-friend-status";
import {
  CHAT_MESSAGE_MAX_LENGTH,
  getOverflowRange,
  shouldShowLengthCounter,
} from "./chat-message-limit";
import { ChatMessageList } from "./chat-message-list";
import type { ChatSendCooldown } from "./chat-rate-limit";
import { ChatSendCooldownGauge } from "./chat-send-cooldown";
import type { ChatConversation } from "./chat-types";
import { ChatZzzIcon } from "./chat-zzz-icon";

/** Five lines of text plus the input's vertical padding. */
const COMPOSER_MAX_HEIGHT = 110;

type ComposerHintKind = "info" | "typing" | "offline" | "error";

const HINT_ROLES: Partial<Record<ComposerHintKind, "alert" | "status">> = {
  error: "alert",
  typing: "status",
};

export interface ChatConversationViewProps {
  conversation: ChatConversation;
  sendCooldown: ChatSendCooldown | null;
  /** Changes whenever the rate limit turns a send away. */
  sendRejections: number;
  onDraftChange: (draft: string) => void;
  onSend: (text: string) => void;
  onRetry: (clientNonce: string) => void;
  onLoadOlder: () => void;
  onReload: () => void;
}

export function ChatConversationView({
  conversation,
  sendCooldown,
  sendRejections,
  onDraftChange,
  onSend,
  onRetry,
  onLoadOlder,
  onReload,
}: ChatConversationViewProps) {
  const { t, i18n } = useTranslation("chat_window");
  const { friend, messages, isTyping, draft, loadState } = conversation;

  const inputRef = useRef<HTMLTextAreaElement>(null);
  const mirrorRef = useRef<HTMLDivElement>(null);

  const numberFormat = useMemo(
    () => new Intl.NumberFormat(i18n.language),
    [i18n.language]
  );

  // Messages already here when the conversation opens render without the
  // entrance animation, so switching tabs doesn't replay the history.
  const [initialMessageIds] = useState(
    () => new Set(messages.map((message) => message.id))
  );

  // Enter on a message over the length limit shakes the composer too.
  const [tooLongRejections, setTooLongRejections] = useState(0);
  const rejections = sendRejections + tooLongRejections;

  // The composer shakes until it has caught up with the latest rejection, so
  // one that lands mid-shake doesn't restart it and opening a tab doesn't
  // replay an old one.
  const [shakenRejections, setShakenRejections] = useState(rejections);
  const isShaking = shakenRejections !== rejections;

  useEffect(() => {
    inputRef.current?.focus();
  }, [friend.id]);

  useLayoutEffect(() => {
    const input = inputRef.current;
    if (!input) return;

    input.style.height = "auto";
    input.style.height = `${Math.min(input.scrollHeight, COMPOSER_MAX_HEIGHT)}px`;

    if (mirrorRef.current) mirrorRef.current.scrollTop = input.scrollTop;
  }, [draft]);

  const text = draft.trim();
  const overflow = getOverflowRange(draft);
  const isTooLong = overflow !== null;
  const showCounter = shouldShowLengthCounter(text.length);
  const canSend = conversation.canSend && text.length > 0 && !isTooLong;
  const hasNoMessages = messages.length === 0;
  const isEmpty = hasNoMessages && loadState === "loaded";
  const hasLoadFailed = hasNoMessages && loadState === "error";

  // Enter during a cooldown still reaches onSend, which shakes the composer.
  const handleSend = () => {
    if (isTooLong) {
      setTooLongRejections((count) => count + 1);
      return;
    }
    if (canSend) onSend(text);
  };

  const handleKeyDown = (event: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (
      event.key === "Enter" &&
      !event.shiftKey &&
      !event.nativeEvent.isComposing
    ) {
      event.preventDefault();
      handleSend();
    }
  };

  let hint: { kind: ComposerHintKind; text: string } | null = null;
  if (!conversation.canSend) {
    hint = {
      kind: "info",
      text: t("cannot_send_hint", { name: friend.displayName }),
    };
  } else if (sendCooldown) {
    hint = { kind: "error", text: t("rate_limited_hint") };
  } else if (isTooLong) {
    hint = {
      kind: "error",
      text: t("message_too_long", {
        count: text.length - CHAT_MESSAGE_MAX_LENGTH,
      }),
    };
  } else if (isTyping) {
    hint = {
      kind: "typing",
      text: t("typing", { name: friend.displayName }),
    };
  } else if (!friend.isOnline) {
    hint = {
      kind: "offline",
      text: t("offline_hint", { name: friend.displayName }),
    };
  } else if (isEmpty) {
    hint = { kind: "info", text: t("enter_hint") };
  }

  return (
    <div className="chat-window__conversation">
      {hasLoadFailed && (
        <div className="chat-window__empty">
          <div className="chat-window__empty-text">
            <p className="chat-window__empty-description">{t("load_failed")}</p>
          </div>
          <button
            type="button"
            className="chat-window__empty-retry"
            onClick={onReload}
          >
            {t("retry")}
          </button>
        </div>
      )}

      {hasNoMessages && !isEmpty && !hasLoadFailed && (
        <div className="chat-window__messages" aria-busy="true" />
      )}

      {isEmpty && (
        <div className="chat-window__empty">
          <span className="chat-window__empty-icon" aria-hidden="true">
            <ChatEmptyIcon />
          </span>
          <div className="chat-window__empty-text">
            <h2 className="chat-window__empty-title">{t("no_messages")}</h2>
            <p className="chat-window__empty-description">
              {t("empty_description", { name: friend.displayName })}
            </p>
          </div>
        </div>
      )}

      {!hasNoMessages && (
        <ChatMessageList
          messages={messages}
          initialMessageIds={initialMessageIds}
          hasMoreBefore={conversation.hasMoreBefore}
          onRetry={onRetry}
          onLoadOlder={onLoadOlder}
        />
      )}

      <div className="chat-window__composer">
        {(hint || showCounter) && (
          <div className="chat-window__composer-meta">
            {hint && (
              <p
                key={hint.kind}
                className={cn("chat-window__composer-hint", {
                  "chat-window__composer-hint--error": hint.kind === "error",
                })}
                role={HINT_ROLES[hint.kind]}
              >
                {hint.kind === "typing" && <ChatTypingDots size="small" />}
                {hint.kind === "offline" && <ChatZzzIcon />}
                {hint.kind === "error" && (
                  <AlertFillIcon size={12} className="chat-window__hint-icon" />
                )}
                <span>{hint.text}</span>
              </p>
            )}

            {showCounter && (
              <span
                className={cn("chat-window__composer-counter", {
                  "chat-window__composer-counter--over": isTooLong,
                })}
              >
                {numberFormat.format(text.length)} /{" "}
                {numberFormat.format(CHAT_MESSAGE_MAX_LENGTH)}
              </span>
            )}
          </div>
        )}

        <div
          className={cn("chat-window__composer-box", {
            "chat-window__composer-box--shake": isShaking,
            "chat-window__composer-box--invalid": isTooLong,
          })}
          onAnimationEnd={(event) => {
            if (event.target === event.currentTarget) {
              setShakenRejections(rejections);
            }
          }}
        >
          <div className="chat-window__composer-field">
            {/* Draws a highlight behind the characters past the limit. */}
            {overflow && (
              <div
                ref={mirrorRef}
                className="chat-window__composer-mirror"
                aria-hidden="true"
              >
                {draft.slice(0, overflow[0])}
                <mark className="chat-window__composer-overflow">
                  {draft.slice(overflow[0], overflow[1])}
                </mark>
                {draft.slice(overflow[1])}
                {/* Keeps a trailing newline's line, as the textarea does. */}
                {"\u200b"}
              </div>
            )}
            <textarea
              ref={inputRef}
              className="chat-window__composer-input"
              rows={1}
              value={draft}
              placeholder={t("message_placeholder", {
                name: friend.displayName,
              })}
              aria-label={t("message_placeholder", {
                name: friend.displayName,
              })}
              aria-invalid={isTooLong}
              onChange={(event) => onDraftChange(event.target.value)}
              onKeyDown={handleKeyDown}
              onScroll={(event) => {
                if (mirrorRef.current) {
                  mirrorRef.current.scrollTop = event.currentTarget.scrollTop;
                }
              }}
              disabled={!conversation.canSend}
            />
          </div>
          <button
            type="button"
            className="chat-window__send"
            onClick={handleSend}
            disabled={!canSend || sendCooldown !== null}
            title={t("send")}
            aria-label={t("send")}
          >
            {sendCooldown ? (
              <ChatSendCooldownGauge
                key={sendCooldown.startedAt}
                cooldown={sendCooldown}
              />
            ) : (
              <PaperAirplaneIcon size={16} />
            )}
          </button>
        </div>
      </div>
    </div>
  );
}
