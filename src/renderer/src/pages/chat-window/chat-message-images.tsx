import { useTranslation } from "react-i18next";
import type { TFunction } from "i18next";
import { EyeClosedIcon, SyncIcon } from "@primer/octicons-react";
import cn from "classnames";

import { getChatImageLayout } from "./chat-attachments";
import type { ChatAttachment, ChatMessage } from "./chat-message-groups";

/** Tall enough for the placeholder's three lines. */
const REMOVED_MIN_HEIGHT = 112;

export interface ChatMessageImagesProps {
  message: ChatMessage;
  /** A caption bubble follows the images. */
  isCaptioned: boolean;
  /** Being replied or reacted to. */
  isHighlighted: boolean;
  /** Just jumped to. */
  isFlashing: boolean;
  /** Spoiler images this viewer already uncovered. */
  revealedIds: ReadonlySet<string>;
  onReveal: (attachment: ChatAttachment) => void;
  onOpen: (attachment: ChatAttachment) => void;
  onRetry: () => void;
}

const getImageLabel = (
  t: TFunction<"chat_window">,
  isCovered: boolean,
  index: number,
  count: number
) => {
  if (count === 1) return t(isCovered ? "show_spoiler_image" : "open_image");
  return t(isCovered ? "show_spoiler_image_of" : "open_image_of", {
    index: index + 1,
    count,
  });
};

/** A message's images: one keeps its shape, more share a grid. */
export function ChatMessageImages({
  message,
  isCaptioned,
  isHighlighted,
  isFlashing,
  revealedIds,
  onReveal,
  onOpen,
  onRetry,
}: Readonly<ChatMessageImagesProps>) {
  const { t } = useTranslation("chat_window");

  const attachments = message.attachments ?? [];
  const layout = getChatImageLayout(attachments);
  const { status } = message;

  const className = cn("chat-window__message-images", {
    "chat-window__message-images--captioned": isCaptioned,
    "chat-window__message-images--grid": layout.columns === 2,
    "chat-window__message-images--replying": isHighlighted,
    "chat-window__message-images--flash": isFlashing,
  });

  if (message.isHidden) {
    return (
      <div
        className="chat-window__message-images chat-window__message-images--removed"
        style={{
          width: layout.width,
          height: Math.max(layout.cells[0]?.height ?? 0, REMOVED_MIN_HEIGHT),
        }}
      >
        <EyeClosedIcon size={16} />
        <span className="chat-window__message-images-removed-title">
          {t("image_removed", { count: attachments.length })}
        </span>
        <span>{t("image_removed_description")}</span>
      </div>
    );
  }

  const isBusy = status === "pending" || status === "checking";
  const isBlocked = status === "blocked";
  const isFailed = status === "failed";
  const isUnsent = status !== "sent";

  return (
    <div className={className} style={{ width: layout.width }}>
      {attachments.map((attachment, index) => {
        const cell = layout.cells[index];
        const src = attachment.localUrl ?? attachment.url;
        const isCovered =
          attachment.spoiler && !isBlocked && !revealedIds.has(attachment.id);
        const label = getImageLabel(t, isCovered, index, attachments.length);

        return (
          <button
            key={attachment.id}
            type="button"
            className={cn("chat-window__message-image", {
              "chat-window__message-image--wide": cell?.isWide,
              "chat-window__message-image--covered": isCovered,
              "chat-window__message-image--dimmed": isBusy || isFailed,
              "chat-window__message-image--blocked": isBlocked,
            })}
            style={{ height: cell?.height }}
            disabled={isUnsent || !src}
            aria-label={label}
            onClick={() =>
              isCovered ? onReveal(attachment) : onOpen(attachment)
            }
          >
            {src && <img src={src} alt="" draggable={false} />}
            {isCovered && (
              <span className="chat-window__message-image-spoiler">
                {t("spoiler")}
              </span>
            )}
          </button>
        );
      })}

      {isBusy && (
        <span
          className="chat-window__message-images-progress"
          aria-hidden="true"
        >
          <span
            className={cn("chat-window__message-images-progress-bar", {
              "chat-window__message-images-progress-bar--checking":
                status === "checking",
            })}
            style={{
              width: `${status === "checking" ? 100 : Math.round((message.uploadProgress ?? 0) * 100)}%`,
            }}
          />
        </span>
      )}

      {isBlocked && (
        <span className="chat-window__message-images-overlay">
          <EyeClosedIcon size={20} />
          <span className="chat-window__message-images-overlay-title">
            {t("image_not_sent")}
          </span>
        </span>
      )}

      {isFailed && (
        <span className="chat-window__message-images-overlay chat-window__message-images-overlay--retry">
          <button
            type="button"
            className="chat-window__message-images-retry"
            onClick={onRetry}
          >
            <SyncIcon size={14} />
            {t("retry")}
          </button>
        </span>
      )}
    </div>
  );
}

export interface ChatMessageImagesStatusProps {
  message: ChatMessage;
  onRetry: () => void;
  onRemove: () => void;
}

/** The line under the user's own images until they are delivered. */
export function ChatMessageImagesStatus({
  message,
  onRetry,
  onRemove,
}: Readonly<ChatMessageImagesStatusProps>) {
  const { t } = useTranslation("chat_window");
  const count = message.attachments?.length ?? 1;

  switch (message.status) {
    case "pending":
      return (
        <output className="chat-window__message-status">
          {t("sending_progress", {
            percent: Math.round((message.uploadProgress ?? 0) * 100),
          })}
        </output>
      );
    case "checking":
      return (
        <output className="chat-window__message-status chat-window__message-status--checking">
          {t("checking_images", { count })}
        </output>
      );
    case "blocked":
      return (
        <output className="chat-window__message-status">
          <span>{t("images_blocked", { count })}</span>
          <button
            type="button"
            className="chat-window__message-status-action"
            onClick={onRemove}
          >
            {t("remove")}
          </button>
        </output>
      );
    case "failed":
      return (
        <output className="chat-window__message-status">
          <span>
            {message.failure === "daily_limit"
              ? t("images_daily_limit")
              : t("images_failed")}
          </span>
          <button
            type="button"
            className="chat-window__message-status-action"
            onClick={onRetry}
          >
            {t("retry")}
          </button>
          <button
            type="button"
            className="chat-window__message-status-action"
            onClick={onRemove}
          >
            {t("remove")}
          </button>
        </output>
      );
    default:
      return null;
  }
}
