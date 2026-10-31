import { useTranslation } from "react-i18next";
import { EyeClosedIcon, XIcon } from "@primer/octicons-react";
import cn from "classnames";

import type { ChatDraftImage } from "./chat-attachments";

export interface ChatComposerImagesProps {
  images: ChatDraftImage[];
  onToggleSpoiler: (id: string) => void;
  onRemove: (id: string) => void;
}

/** The images waiting in the composer, each with its spoiler and remove buttons. */
export function ChatComposerImages({
  images,
  onToggleSpoiler,
  onRemove,
}: Readonly<ChatComposerImagesProps>) {
  const { t } = useTranslation("chat_window");

  return (
    <ul
      className="chat-window__composer-images"
      aria-label={t("images_to_send")}
    >
      {images.map((image, index) => {
        const name = image.name || t("image_number", { index: index + 1 });

        return (
          <li key={image.id} className="chat-window__composer-image">
            <span
              className={cn("chat-window__composer-image-preview", {
                "chat-window__composer-image-preview--spoiler": image.spoiler,
              })}
            >
              <img src={image.url} alt={name} draggable={false} />
              {image.spoiler && (
                <span
                  className="chat-window__composer-image-spoiler"
                  aria-hidden="true"
                >
                  {t("spoiler")}
                </span>
              )}
            </span>
            <span className="chat-window__composer-image-tools">
              <button
                type="button"
                className="chat-window__composer-image-tool"
                onClick={() => onToggleSpoiler(image.id)}
                aria-pressed={image.spoiler}
                aria-label={t("mark_as_spoiler", { name })}
                title={t("spoiler")}
              >
                <EyeClosedIcon size={12} />
              </button>
              <button
                type="button"
                className="chat-window__composer-image-tool"
                onClick={() => onRemove(image.id)}
                aria-label={t("remove_image", { name })}
                title={t("remove")}
              >
                <XIcon size={12} />
              </button>
            </span>
          </li>
        );
      })}
    </ul>
  );
}
