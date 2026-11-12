import { useEffect, useRef } from "react";
import { useTranslation } from "react-i18next";
import { XIcon } from "@primer/octicons-react";

export interface ChatImageLightboxProps {
  src: string;
  /** Who sent it and when, shown over the image. */
  caption: string;
  onClose: () => void;
}

/** An image at full size over the whole window. Esc or a click closes it. */
export function ChatImageLightbox({
  src,
  caption,
  onClose,
}: Readonly<ChatImageLightboxProps>) {
  const { t } = useTranslation("chat_window");
  const dialogRef = useRef<HTMLDialogElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);

  // A modal dialog sits in the top layer over the window controls too, and
  // hands focus back to the opener when it closes.
  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;

    dialog.showModal();
    closeRef.current?.focus();
    return () => dialog.close();
  }, []);

  return (
    <dialog
      ref={dialogRef}
      className="chat-window__lightbox"
      aria-label={t("image")}
      onCancel={(event) => {
        event.preventDefault();
        onClose();
      }}
    >
      <div className="chat-window__lightbox-bar">
        <span className="chat-window__lightbox-caption">{caption}</span>
        <button
          ref={closeRef}
          type="button"
          className="chat-window__lightbox-close"
          onClick={onClose}
          aria-label={t("close_image")}
          title={t("close_image")}
        >
          <XIcon size={16} />
        </button>
      </div>
      <button
        type="button"
        className="chat-window__lightbox-stage"
        onClick={onClose}
        tabIndex={-1}
        aria-label={t("close_image")}
      >
        <img src={src} alt="" className="chat-window__lightbox-image" />
      </button>
    </dialog>
  );
}
