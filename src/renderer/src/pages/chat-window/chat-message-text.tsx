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
export function ChatMessageText({ text, onOpenLink }: ChatMessageTextProps) {
  const parts = useMemo(() => splitMessageLinks(text), [text]);

  return (
    <span className="chat-window__message-text">
      {parts.map((part, index) =>
        part.type === "text" ? (
          <Fragment key={index}>{part.text}</Fragment>
        ) : (
          <a
            key={index}
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
