import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { Trans, useTranslation } from "react-i18next";
import type { TFunction } from "i18next";
import {
  AlertFillIcon,
  ImageIcon,
  PaperAirplaneIcon,
  ReplyIcon,
  SmileyIcon,
  XIcon,
} from "@primer/octicons-react";
import cn from "classnames";

import {
  CHAT_ATTACHMENTS_PER_MESSAGE,
  fitsMessageBudget,
  selectImageFiles,
  type ChatDraftImage,
  type ChatDraftImageError,
} from "./chat-attachments";
import { ChatComposerImages } from "./chat-composer-images";
import { ChatEmojiPicker } from "./chat-emoji-picker";
import { ChatImagePrepError, prepareChatImage } from "./chat-image-prep";
import { ChatEmptyIcon } from "./chat-empty-icon";
import { ChatTypingDots } from "./chat-friend-status";
import {
  CHAT_MESSAGE_MAX_LENGTH,
  getOverflowRange,
  shouldShowLengthCounter,
} from "./chat-message-limit";
import type { ChatMessage } from "./chat-message-groups";
import { ChatMessageList } from "./chat-message-list";
import type { ChatSendCooldown } from "./chat-rate-limit";
import { ChatSendCooldownGauge } from "./chat-send-cooldown";
import type { ChatConversation } from "./chat-types";
import { ChatZzzIcon } from "./chat-zzz-icon";
import type { ChatReactionErrorKind } from "./use-chat";

/** Five lines of text plus the input's vertical padding. */
const COMPOSER_MAX_HEIGHT = 110;
const IMAGE_NOTE_DURATION_MS = 4_000;

const hasFiles = (event: React.DragEvent) =>
  Array.from(event.dataTransfer.types).includes("Files");

type ComposerHintKind = "info" | "typing" | "offline" | "error";

const HINT_ROLES: Partial<Record<ComposerHintKind, "alert" | "status">> = {
  error: "alert",
  typing: "status",
};

interface ComposerHintState {
  canSend: boolean;
  isRateLimited: boolean;
  reactionError: ChatReactionErrorKind | null;
  /** Why picked images were left out of the composer, if any were. */
  imageError: ChatDraftImageError | null;
  /** Characters over the length limit; null within it. */
  tooLongBy: number | null;
  isTyping: boolean;
  isFriendOnline: boolean;
  isEmpty: boolean;
  friendName: string;
}

/** The line under the composer: the most pressing thing to tell the user. */
const getComposerHint = (
  state: ComposerHintState,
  t: TFunction<"chat_window">
): { kind: ComposerHintKind; text: string } | null => {
  const name = state.friendName;

  if (!state.canSend) {
    return { kind: "info", text: t("cannot_send_hint", { name }) };
  }
  if (state.isRateLimited) {
    return { kind: "error", text: t("rate_limited_hint") };
  }
  if (state.reactionError) {
    return {
      kind: "error",
      text:
        state.reactionError === "rate_limited"
          ? t("reaction_rate_limited_hint")
          : t("reaction_failed_hint"),
    };
  }
  if (state.imageError) {
    return {
      kind: "error",
      text:
        state.imageError === "too_many"
          ? t("image_error_too_many", { count: CHAT_ATTACHMENTS_PER_MESSAGE })
          : t(`image_error_${state.imageError}`),
    };
  }
  if (state.tooLongBy !== null) {
    return {
      kind: "error",
      text: t("message_too_long", { count: state.tooLongBy }),
    };
  }
  if (state.isTyping) return { kind: "typing", text: t("typing", { name }) };
  if (!state.isFriendOnline) {
    return { kind: "offline", text: t("offline_hint", { name }) };
  }
  if (state.isEmpty) return { kind: "info", text: t("enter_hint") };
  return null;
};

export interface ChatConversationViewProps {
  conversation: ChatConversation;
  /** Whether the server accepts images right now (the CHAT_IMAGES feature). */
  imagesEnabled: boolean;
  sendCooldown: ChatSendCooldown | null;
  /** Changes whenever the rate limit turns a send away. */
  sendRejections: number;
  onDraftChange: (draft: string) => void;
  onDraftImagesChange: (
    update: (images: ChatDraftImage[]) => ChatDraftImage[]
  ) => void;
  onReplyChange: (replyToSeq: number | null) => void;
  onSend: (text: string) => void;
  /** Sets the user's reaction on the message with `seq`; null removes it. */
  onReact: (seq: number, emoji: string | null) => void;
  /** Why the user's last reaction change was not saved, if it wasn't. */
  reactionError: ChatReactionErrorKind | null;
  onRetry: (clientNonce: string) => void;
  /** Drops a message that was not sent. */
  onRemove: (clientNonce: string) => void;
  onLoadOlder: () => void;
  /** Resolves to whether the message with `seq` is loaded afterwards. */
  onLoadThrough: (seq: number) => Promise<boolean>;
  onReload: () => void;
}

export function ChatConversationView({
  conversation,
  imagesEnabled,
  sendCooldown,
  sendRejections,
  onDraftChange,
  onDraftImagesChange,
  onReplyChange,
  onSend,
  onReact,
  reactionError,
  onRetry,
  onRemove,
  onLoadOlder,
  onLoadThrough,
  onReload,
}: Readonly<ChatConversationViewProps>) {
  const { t, i18n } = useTranslation("chat_window");
  const { friend, messages, isTyping, draft, draftImages, loadState } =
    conversation;
  const canAttachImages = imagesEnabled && conversation.canSend;

  const inputRef = useRef<HTMLTextAreaElement>(null);
  const mirrorRef = useRef<HTMLDivElement>(null);
  const emojiButtonRef = useRef<HTMLButtonElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [imageNote, setImageNote] = useState<ChatDraftImageError | null>(null);
  const [isDraggingFiles, setIsDraggingFiles] = useState(false);
  // Drag events fire for every element crossed; only the last leave counts.
  const dragDepthRef = useRef(0);
  // Images still being prepared hold their place against the per-message limit.
  const preparingCountRef = useRef(0);
  const [preparingCount, setPreparingCount] = useState(0);
  // Ahead of rendering, so preparations finishing together see each other.
  const draftImagesRef = useRef(draftImages);

  useEffect(() => {
    draftImagesRef.current = draftImages;
  }, [draftImages]);

  useEffect(() => {
    if (!imageNote) return;

    const timer = setTimeout(() => setImageNote(null), IMAGE_NOTE_DURATION_MS);
    return () => clearTimeout(timer);
  }, [imageNote]);

  const addImages = (files: File[]) => {
    if (!conversation.canSend || files.length === 0) return;

    const { files: picked, error } = selectImageFiles(
      files,
      draftImagesRef.current.length + preparingCountRef.current
    );
    if (error) setImageNote(error);

    for (const file of picked) {
      preparingCountRef.current += 1;
      setPreparingCount((count) => count + 1);

      void prepareChatImage(file)
        .then((prepared) => {
          if (!fitsMessageBudget(draftImagesRef.current, prepared.blob.size)) {
            URL.revokeObjectURL(prepared.url);
            setImageNote("too_large");
            return;
          }

          const image = {
            ...prepared,
            id: crypto.randomUUID(),
            spoiler: false,
          };
          draftImagesRef.current = [...draftImagesRef.current, image];
          onDraftImagesChange((images) => [...images, image]);
        })
        .catch((prepError: unknown) => {
          setImageNote(
            prepError instanceof ChatImagePrepError
              ? prepError.reason
              : "unreadable"
          );
        })
        .finally(() => {
          preparingCountRef.current -= 1;
          setPreparingCount((count) => count - 1);
        });
    }

    inputRef.current?.focus();
  };

  const removeImage = (id: string) => {
    const image = draftImages.find((current) => current.id === id);
    if (image) URL.revokeObjectURL(image.url);
    onDraftImagesChange((images) =>
      images.filter((current) => current.id !== id)
    );
    inputRef.current?.focus();
  };

  const toggleSpoiler = (id: string) =>
    onDraftImagesChange((images) =>
      images.map((image) =>
        image.id === id ? { ...image, spoiler: !image.spoiler } : image
      )
    );

  const dropHandlers = {
    onDragEnter: (event: React.DragEvent) => {
      if (!hasFiles(event) || !canAttachImages) return;
      event.preventDefault();
      dragDepthRef.current += 1;
      setIsDraggingFiles(true);
    },
    onDragOver: (event: React.DragEvent) => {
      if (!hasFiles(event) || !canAttachImages) return;
      event.preventDefault();
      event.dataTransfer.dropEffect = "copy";
    },
    onDragLeave: (event: React.DragEvent) => {
      if (!hasFiles(event)) return;
      dragDepthRef.current = Math.max(dragDepthRef.current - 1, 0);
      if (dragDepthRef.current === 0) setIsDraggingFiles(false);
    },
    onDrop: (event: React.DragEvent) => {
      if (!hasFiles(event) || !canAttachImages) return;
      event.preventDefault();
      dragDepthRef.current = 0;
      setIsDraggingFiles(false);
      addImages(Array.from(event.dataTransfer.files));
    },
  };

  const [isEmojiPickerOpen, setIsEmojiPickerOpen] = useState(false);
  // Where picked emoji go while focus is in the picker: the textarea's
  // selection survives the blur, but React resets it on every value change.
  const selectionRef = useRef<{ start: number; end: number } | null>(null);

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
  const hasImages = draftImages.length > 0;
  const canSend =
    conversation.canSend &&
    (text.length > 0 || hasImages) &&
    !isTooLong &&
    preparingCount === 0;
  const placeholder = hasImages
    ? t("add_message_placeholder")
    : t("message_placeholder", { name: friend.displayName });
  const hasNoMessages = messages.length === 0;
  const isEmpty = hasNoMessages && loadState === "loaded";
  const hasLoadFailed = hasNoMessages && loadState === "error";

  const replyTarget =
    conversation.replyToSeq === null
      ? null
      : (messages.find((message) => message.seq === conversation.replyToSeq) ??
        null);

  // Set by the reply strip, so the list scrolls to the message being answered.
  const [revealSeq, setRevealSeq] = useState<{ seq: number } | null>(null);

  const startReply = (message: ChatMessage) => {
    if (message.seq === undefined) return;
    onReplyChange(message.seq);
    inputRef.current?.focus();
  };

  const cancelReply = () => {
    onReplyChange(null);
    inputRef.current?.focus();
  };

  const toggleEmojiPicker = () => {
    if (!isEmojiPickerOpen) {
      selectionRef.current = {
        start: inputRef.current?.selectionStart ?? draft.length,
        end: inputRef.current?.selectionEnd ?? draft.length,
      };
    }
    setIsEmojiPickerOpen((isOpen) => !isOpen);
  };

  const closeEmojiPicker = useCallback(() => {
    setIsEmojiPickerOpen(false);
    inputRef.current?.focus();
  }, []);

  const insertEmoji = (emoji: string) => {
    const selection = selectionRef.current;
    const start = Math.min(selection?.start ?? draft.length, draft.length);
    const end = Math.min(
      Math.max(selection?.end ?? start, start),
      draft.length
    );
    const caret = start + emoji.length;

    selectionRef.current = { start: caret, end: caret };
    onDraftChange(draft.slice(0, start) + emoji + draft.slice(end));
  };

  // Keeps the caret after the last picked emoji, for the next pick and for
  // typing once the picker closes.
  useLayoutEffect(() => {
    const input = inputRef.current;
    const selection = selectionRef.current;
    if (!isEmojiPickerOpen || !input || !selection) return;
    input.setSelectionRange(selection.start, selection.end);
  }, [draft, isEmojiPickerOpen]);

  // Enter during a cooldown still reaches onSend, which shakes the composer.
  const handleSend = () => {
    if (isTooLong) {
      setTooLongRejections((count) => count + 1);
      return;
    }
    if (canSend) {
      setIsEmojiPickerOpen(false);
      onSend(text);
    }
  };

  const handleKeyDown = (event: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === "Escape" && replyTarget) {
      event.preventDefault();
      onReplyChange(null);
      return;
    }

    if (
      event.key === "Enter" &&
      !event.shiftKey &&
      !event.nativeEvent.isComposing
    ) {
      event.preventDefault();
      handleSend();
    }
  };

  const hint = getComposerHint(
    {
      canSend: conversation.canSend,
      isRateLimited: sendCooldown !== null,
      reactionError,
      imageError: imageNote,
      tooLongBy: isTooLong ? text.length - CHAT_MESSAGE_MAX_LENGTH : null,
      isTyping,
      isFriendOnline: Boolean(friend.isOnline),
      isEmpty,
      friendName: friend.displayName,
    },
    t
  );

  return (
    // Drops are a shortcut for the image button, which stays the way in for
    // keyboard users.
    // eslint-disable-next-line jsx-a11y/no-static-element-interactions
    <div className="chat-window__conversation" {...dropHandlers}>
      {isDraggingFiles && (
        <div className="chat-window__drop" aria-hidden="true">
          <div className="chat-window__drop-target">
            <ImageIcon size={24} />
            <span className="chat-window__drop-title">
              {t("drop_images", { name: friend.displayName })}
            </span>
            <span className="chat-window__drop-description">
              {t("drop_images_limit", { count: CHAT_ATTACHMENTS_PER_MESSAGE })}
            </span>
          </div>
        </div>
      )}

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
          friendId={friend.id}
          messages={messages}
          initialMessageIds={initialMessageIds}
          hasMoreBefore={conversation.hasMoreBefore}
          friendName={friend.displayName}
          canReply={conversation.canSend}
          replyToSeq={replyTarget?.seq ?? null}
          revealSeq={revealSeq}
          onReply={startReply}
          onReact={onReact}
          onRetry={onRetry}
          onRemove={onRemove}
          onLoadOlder={onLoadOlder}
          onLoadThrough={onLoadThrough}
        />
      )}

      <div className="chat-window__composer">
        {isEmojiPickerOpen && (
          <ChatEmojiPicker
            label={t("choose_emoji")}
            className="chat-window__emoji-picker--composer"
            anchorRef={emojiButtonRef}
            onPick={insertEmoji}
            onClose={closeEmojiPicker}
          />
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
          {replyTarget && (
            <div className="chat-window__composer-reply">
              <button
                type="button"
                className="chat-window__composer-reply-target"
                onClick={() =>
                  replyTarget.seq !== undefined &&
                  setRevealSeq({ seq: replyTarget.seq })
                }
                title={t("show_replied_message")}
              >
                <ReplyIcon
                  size={16}
                  className="chat-window__composer-reply-icon"
                />
                <span className="chat-window__composer-reply-details">
                  <span className="chat-window__composer-reply-label">
                    {replyTarget.fromMe ? (
                      <Trans
                        i18nKey="replying_to_self"
                        ns="chat_window"
                        components={{ strong: <strong /> }}
                      />
                    ) : (
                      <Trans
                        i18nKey="replying_to"
                        ns="chat_window"
                        values={{ name: friend.displayName }}
                        components={{ strong: <strong /> }}
                      />
                    )}
                  </span>
                  <span className="chat-window__composer-reply-text">
                    {replyTarget.text ||
                      (replyTarget.attachments?.length
                        ? t("quoted_images", {
                            count: replyTarget.attachments.length,
                          })
                        : "")}
                  </span>
                </span>
              </button>
              <button
                type="button"
                className="chat-window__icon-button chat-window__icon-button--small"
                onClick={cancelReply}
                title={t("cancel_reply_hint")}
                aria-label={t("cancel_reply")}
              >
                <XIcon size={16} />
              </button>
            </div>
          )}

          {hasImages && (
            <ChatComposerImages
              images={draftImages}
              onToggleSpoiler={toggleSpoiler}
              onRemove={removeImage}
            />
          )}

          <div className="chat-window__composer-row">
            {imagesEnabled && (
              <>
                <input
                  ref={fileInputRef}
                  type="file"
                  accept="image/*"
                  multiple
                  hidden
                  onChange={(event) => {
                    addImages(Array.from(event.target.files ?? []));
                    // The same file can be picked again after it is removed.
                    event.target.value = "";
                  }}
                />
                <button
                  type="button"
                  className="chat-window__composer-emoji"
                  onClick={() => fileInputRef.current?.click()}
                  disabled={
                    !canAttachImages ||
                    draftImages.length >= CHAT_ATTACHMENTS_PER_MESSAGE
                  }
                  title={t("add_images")}
                  aria-label={t("add_images")}
                >
                  <ImageIcon size={16} />
                </button>
              </>
            )}
            <button
              ref={emojiButtonRef}
              type="button"
              className={cn("chat-window__composer-emoji", {
                "chat-window__composer-emoji--open": isEmojiPickerOpen,
              })}
              onClick={toggleEmojiPicker}
              disabled={!conversation.canSend}
              title={t("add_emoji")}
              aria-label={t("add_emoji")}
              aria-expanded={isEmojiPickerOpen}
            >
              <SmileyIcon size={16} />
            </button>
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
                placeholder={placeholder}
                aria-label={placeholder}
                aria-invalid={isTooLong}
                onChange={(event) => onDraftChange(event.target.value)}
                onKeyDown={handleKeyDown}
                onPaste={(event) => {
                  const files = Array.from(event.clipboardData.files);
                  if (files.length === 0 || !canAttachImages) return;
                  event.preventDefault();
                  addImages(files);
                }}
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

        {/* Always rendered: it sits in space kept for it, so a hint showing up
            doesn't move anything. */}
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
      </div>
    </div>
  );
}
