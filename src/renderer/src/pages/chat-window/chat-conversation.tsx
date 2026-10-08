import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  CommentDiscussionIcon,
  PaperAirplaneIcon,
} from "@primer/octicons-react";

import { ChatConversationHeader } from "./chat-conversation-header";
import { ChatMessageList } from "./chat-message-list";
import type { ChatConversation } from "./chat-types";

/** Five lines of text plus the input's vertical padding. */
const COMPOSER_MAX_HEIGHT = 110;

export interface ChatConversationViewProps {
  conversation: ChatConversation;
  onDraftChange: (draft: string) => void;
  onClose: () => void;
  onSend: (text: string) => void;
  onRetry: (clientNonce: string) => void;
  onLoadOlder: () => void;
  onReload: () => void;
}

export function ChatConversationView({
  conversation,
  onDraftChange,
  onClose,
  onSend,
  onRetry,
  onLoadOlder,
  onReload,
}: ChatConversationViewProps) {
  const { t } = useTranslation("chat_window");
  const { friend, messages, isTyping, draft, loadState } = conversation;

  const inputRef = useRef<HTMLTextAreaElement>(null);

  // Messages already here when the conversation opens render without the
  // entrance animation, so switching tabs doesn't replay the history.
  const [initialMessageIds] = useState(
    () => new Set(messages.map((message) => message.id))
  );

  useEffect(() => {
    inputRef.current?.focus();
  }, [friend.id]);

  useLayoutEffect(() => {
    const input = inputRef.current;
    if (!input) return;

    input.style.height = "auto";
    input.style.height = `${Math.min(input.scrollHeight, COMPOSER_MAX_HEIGHT)}px`;
  }, [draft]);

  const text = draft.trim();
  const canSend = conversation.canSend && text.length > 0;
  const hasNoMessages = messages.length === 0 && !isTyping;
  const isEmpty = hasNoMessages && loadState === "loaded";
  const hasLoadFailed = hasNoMessages && loadState === "error";

  const handleSend = () => {
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

  let hint: string | null = null;
  if (!conversation.canSend) {
    hint = t("cannot_send_hint", { name: friend.displayName });
  } else if (!friend.isOnline) {
    hint = t("offline_hint", { name: friend.displayName });
  } else if (isEmpty) {
    hint = t("enter_hint");
  }

  return (
    <div className="chat-window__conversation">
      <ChatConversationHeader friend={friend} onClose={onClose} />

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
            <CommentDiscussionIcon size={20} />
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
          isTyping={isTyping}
          friendName={friend.displayName}
          hasMoreBefore={conversation.hasMoreBefore}
          onRetry={onRetry}
          onLoadOlder={onLoadOlder}
        />
      )}

      <div className="chat-window__composer">
        <div className="chat-window__composer-box">
          <textarea
            ref={inputRef}
            className="chat-window__composer-input"
            rows={1}
            value={draft}
            placeholder={t("message_placeholder", { name: friend.displayName })}
            aria-label={t("message_placeholder", { name: friend.displayName })}
            onChange={(event) => onDraftChange(event.target.value)}
            onKeyDown={handleKeyDown}
            disabled={!conversation.canSend}
          />
          <button
            type="button"
            className="chat-window__send"
            onClick={handleSend}
            disabled={!canSend}
            title={t("send")}
            aria-label={t("send")}
          >
            <PaperAirplaneIcon size={16} />
          </button>
        </div>

        {hint && <p className="chat-window__composer-hint">{hint}</p>}
      </div>
    </div>
  );
}
