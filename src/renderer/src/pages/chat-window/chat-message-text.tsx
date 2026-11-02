import { Fragment, useMemo } from "react";
import { LinkExternalIcon } from "@primer/octicons-react";

import { splitMessageLinks } from "./chat-links";

export interface ChatMessageTextProps {
  text: string;
  onOpenLink: (url: string) => void;
}

/**
 * A message's text with its web links. Links never navigate the window; they
 * go through `onOpenLink`, which asks before leaving Hydra.
 */
export function ChatMessageText({
  text,
  onOpenLink,
}: Readonly<ChatMessageTextProps>) {
  // Each part is keyed by where it starts in the text.
  const parts = useMemo(() => {
    let offset = 0;

    return splitMessageLinks(text).map((part) => {
      const key = offset;
      offset += part.text.length;
      return { ...part, key };
    });
  }, [text]);

  return (
    <span className="chat-window__message-text">
      {parts.map((part) =>
        part.type === "text" ? (
          <Fragment key={part.key}>{part.text}</Fragment>
        ) : (
          <a
            key={part.key}
            href={part.url}
            className="chat-window__message-link"
            title={part.url}
            onClick={(event) => {
              event.preventDefault();
              onOpenLink(part.url);
            }}
            onAuxClick={(event) => {
              // Middle click would otherwise try to open a new window.
              if (event.button !== 1) return;
              event.preventDefault();
              onOpenLink(part.url);
            }}
          >
            {part.text}
            <LinkExternalIcon
              size={12}
              className="chat-window__message-link-icon"
            />
          </a>
        )
      )}
    </span>
  );
}
