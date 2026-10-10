import { useEffect, useRef, useState, type RefObject } from "react";
import { useTranslation } from "react-i18next";
import { PlusIcon } from "@primer/octicons-react";
import cn from "classnames";

import { QUICK_REACTIONS } from "./chat-emoji";
import type { ChatReactionPill } from "./chat-reactions";

export interface ChatReactionBarProps {
  /** The user's current reaction on the message, marked in the bar. */
  selected: string | null;
  placement: "above" | "below";
  align: "start" | "end";
  /** Clicks here don't dismiss the bar, so its toggle button can close it. */
  anchorRef: RefObject<HTMLElement | null>;
  onPick: (emoji: string) => void;
  onMore: () => void;
  onClose: () => void;
}

/** The quick reactions shown over a message, plus a way into the full picker. */
export function ChatReactionBar({
  selected,
  placement,
  align,
  anchorRef,
  onPick,
  onMore,
  onClose,
}: ChatReactionBarProps) {
  const { t } = useTranslation("chat_window");
  const barRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const buttons = barRef.current?.querySelectorAll("button");
    const selectedIndex = QUICK_REACTIONS.indexOf(selected ?? "");
    buttons?.[Math.max(selectedIndex, 0)]?.focus();
  }, [selected]);

  useEffect(() => {
    const handlePointerDown = (event: MouseEvent) => {
      const target = event.target as Node;
      if (
        !barRef.current?.contains(target) &&
        !anchorRef.current?.contains(target)
      ) {
        onClose();
      }
    };

    document.addEventListener("mousedown", handlePointerDown);
    return () => document.removeEventListener("mousedown", handlePointerDown);
  }, [anchorRef, onClose]);

  const handleKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    if (event.key === "Escape") {
      event.stopPropagation();
      onClose();
      anchorRef.current?.focus();
      return;
    }

    if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;

    const buttons = [...(barRef.current?.querySelectorAll("button") ?? [])];
    const index = buttons.indexOf(document.activeElement as HTMLButtonElement);
    const step = event.key === "ArrowRight" ? 1 : -1;
    event.preventDefault();
    buttons[(index + step + buttons.length) % buttons.length]?.focus();
  };

  return (
    <div
      ref={barRef}
      className={cn(
        "chat-window__reaction-bar",
        `chat-window__reaction-bar--${placement}`,
        `chat-window__reaction-bar--${align}`
      )}
      role="toolbar"
      aria-label={t("quick_reactions")}
      onKeyDown={handleKeyDown}
    >
      {QUICK_REACTIONS.map((emoji) => (
        <button
          key={emoji}
          type="button"
          className="chat-window__reaction-option"
          aria-label={t("react_with", { emoji })}
          aria-pressed={emoji === selected}
          onClick={() => onPick(emoji)}
        >
          <span className="chat-window__emoji-glyph">{emoji}</span>
        </button>
      ))}
      <span className="chat-window__reaction-bar-divider" aria-hidden="true" />
      <button
        type="button"
        className="chat-window__reaction-more"
        aria-label={t("more_reactions")}
        title={t("more_reactions")}
        onClick={onMore}
      >
        <PlusIcon size={16} />
      </button>
    </div>
  );
}

export interface ChatReactionPillsProps {
  pills: ChatReactionPill[];
  friendName: string;
  align: "start" | "end";
  /** Bare emoji messages have no bubble edge for the pills to overlap. */
  isDetached: boolean;
  /** False once the users can no longer message each other: pills only show. */
  canReact: boolean;
  onToggle: (pill: ChatReactionPill) => void;
}

export function ChatReactionPills({
  pills,
  friendName,
  align,
  isDetached,
  canReact,
  onToggle,
}: ChatReactionPillsProps) {
  const { t } = useTranslation("chat_window");
  const hasMine = pills.some((pill) => pill.fromMe);

  // Pills already there when the message renders don't pop in, so opening a
  // conversation doesn't replay every reaction.
  const [initialEmojis] = useState(
    () => new Set(pills.map((pill) => pill.emoji))
  );

  if (pills.length === 0) return null;

  const describe = (pill: ChatReactionPill) => {
    const { emoji } = pill;

    if (pill.fromMe && pill.fromFriend) {
      return {
        label: t("reaction_both", { name: friendName, emoji }),
        hint: t("reaction_remove_yours"),
      };
    }
    if (pill.fromMe) {
      return {
        label: t("reaction_mine", { emoji }),
        hint: t("reaction_remove"),
      };
    }
    return {
      label: t("reaction_friend", { name: friendName, emoji }),
      hint: hasMine ? t("reaction_switch", { emoji }) : t("reaction_add"),
    };
  };

  return (
    <div
      className={cn(
        "chat-window__reactions",
        `chat-window__reactions--${align}`,
        {
          "chat-window__reactions--detached": isDetached,
        }
      )}
    >
      {pills.map((pill) => {
        const { label, hint } = describe(pill);

        return (
          <span key={pill.emoji} className="chat-window__reaction-wrapper">
            <button
              type="button"
              className={cn("chat-window__reaction", {
                "chat-window__reaction--enter": !initialEmojis.has(pill.emoji),
                "chat-window__reaction--mine": pill.fromMe,
                "chat-window__reaction--pending": pill.isPending,
                "chat-window__reaction--static": !canReact,
              })}
              aria-pressed={pill.fromMe}
              aria-disabled={!canReact || undefined}
              aria-label={canReact ? `${label}. ${hint}` : label}
              onClick={() => {
                if (canReact && !pill.isPending) onToggle(pill);
              }}
            >
              <span className="chat-window__emoji-glyph">{pill.emoji}</span>
              {pill.fromMe && pill.fromFriend && (
                <span className="chat-window__reaction-count">2</span>
              )}
            </button>
            <span className="chat-window__reaction-tooltip" aria-hidden="true">
              <span className="chat-window__reaction-tooltip-label">
                {label}
              </span>
              {canReact && (
                <span className="chat-window__reaction-tooltip-hint">
                  {hint}
                </span>
              )}
            </span>
          </span>
        );
      })}
    </div>
  );
}
