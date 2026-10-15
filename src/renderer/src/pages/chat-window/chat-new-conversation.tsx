import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { PlusIcon, SearchIcon } from "@primer/octicons-react";
import cn from "classnames";

import type { UserFriend } from "@types";

import { ChatFriendAvatar, ChatFriendStatus } from "./chat-friend-status";

const PICKER_WIDTH = 288;
/** Space kept between the picker and the window's edges. */
const PICKER_EDGE_MARGIN = 8;
/** Matches `.chat-window__picker-option`'s height. */
const OPTION_HEIGHT = 44;
/** Rows past this one fade in together, so a long list doesn't lag. */
const MAX_STAGGERED_OPTIONS = 8;

const prefersReducedMotion = () =>
  window.matchMedia("(prefers-reduced-motion: reduce)").matches;

type PickerPhase = "closed" | "open" | "closing";

/** Where the picker sits under the button, and where it grows from. */
interface PickerPlacement {
  left: number;
  clipLeft: number;
  clipRight: number;
}

const highlightMatch = (name: string, query: string) => {
  const start = query ? name.toLocaleLowerCase().indexOf(query) : -1;
  if (start === -1) return name;

  const end = start + query.length;
  return (
    <>
      {name.slice(0, start)}
      <mark className="chat-window__picker-match">
        {name.slice(start, end)}
      </mark>
      {name.slice(end)}
    </>
  );
};

export interface ChatNewConversationProps {
  friends: UserFriend[];
  openFriendIds: Set<string>;
  /** Asks for a fresh friends list as the picker opens. */
  onOpen: () => void;
  onPick: (friend: UserFriend) => void;
}

/** The tab strip's "+" and the friend picker it opens (also Ctrl+T). */
export function ChatNewConversation({
  friends,
  openFriendIds,
  onOpen,
  onPick,
}: Readonly<ChatNewConversationProps>) {
  const { t } = useTranslation("chat_window");

  const containerRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const optionRefs = useRef<(HTMLButtonElement | null)[]>([]);

  const [phase, setPhase] = useState<PickerPhase>("closed");
  const [placement, setPlacement] = useState<PickerPlacement | null>(null);
  // Set once the picker has finished opening, so rows that a search brings in
  // later show up at once instead of replaying the entrance.
  const [isSettled, setIsSettled] = useState(false);
  const [query, setQuery] = useState("");
  const [activeIndex, setActiveIndex] = useState(0);

  const isOpen = phase === "open";

  // Under the button, kept inside the window, growing out of the button.
  const measure = useCallback((): PickerPlacement | null => {
    const button = buttonRef.current?.getBoundingClientRect();
    if (!button) return null;

    const left = Math.max(
      PICKER_EDGE_MARGIN,
      Math.min(
        button.right - PICKER_WIDTH,
        window.innerWidth - PICKER_EDGE_MARGIN - PICKER_WIDTH
      )
    );
    const clipLeft = button.left - left;

    return {
      left: left - button.left,
      clipLeft,
      clipRight: Math.max(0, PICKER_WIDTH - clipLeft - button.width),
    };
  }, []);

  const open = useCallback(() => {
    setQuery("");
    setActiveIndex(0);
    setIsSettled(false);
    setPlacement(measure());
    setPhase("open");
    onOpen();
  }, [measure, onOpen]);

  // Without motion there is no exit animation to wait for.
  const close = useCallback(() => {
    setPhase((current) => {
      if (current !== "open") return current;
      return prefersReducedMotion() ? "closed" : "closing";
    });
  }, []);

  const toggle = useCallback(() => {
    if (isOpen) close();
    else open();
  }, [isOpen, open, close]);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (
        event.ctrlKey &&
        !event.shiftKey &&
        !event.altKey &&
        !event.metaKey &&
        event.key.toLowerCase() === "t"
      ) {
        event.preventDefault();
        toggle();
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [toggle]);

  useEffect(() => {
    if (isOpen) inputRef.current?.focus();
  }, [isOpen]);

  // A click outside the window doesn't reach the document, so leaving the
  // window counts as one. Escape works wherever focus is in the picker.
  useEffect(() => {
    if (!isOpen) return;

    const handlePointerDown = (event: MouseEvent) => {
      if (!containerRef.current?.contains(event.target as Node)) close();
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;

      close();
      buttonRef.current?.focus();
    };
    const handleResize = () => setPlacement(measure());

    document.addEventListener("mousedown", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown);
    window.addEventListener("blur", close);
    window.addEventListener("resize", handleResize);
    return () => {
      document.removeEventListener("mousedown", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown);
      window.removeEventListener("blur", close);
      window.removeEventListener("resize", handleResize);
    };
  }, [isOpen, close, measure]);

  const normalizedQuery = query.trim().toLocaleLowerCase();

  // Online friends first, each group in the order the API returns.
  const matches = useMemo(
    () =>
      friends
        .filter((friend) =>
          friend.displayName.toLocaleLowerCase().includes(normalizedQuery)
        )
        .sort(
          (a, b) => Number(Boolean(b.isOnline)) - Number(Boolean(a.isOnline))
        ),
    [friends, normalizedQuery]
  );

  const active = Math.min(activeIndex, matches.length - 1);

  useEffect(() => {
    optionRefs.current[active]?.scrollIntoView({ block: "nearest" });
  }, [active]);

  const pick = (friend: UserFriend) => {
    onPick(friend);
    close();
  };

  const handleSearchKeyDown = (
    event: React.KeyboardEvent<HTMLInputElement>
  ) => {
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      const step = event.key === "ArrowDown" ? 1 : -1;
      setActiveIndex(
        Math.min(Math.max(active + step, 0), Math.max(matches.length - 1, 0))
      );
      return;
    }

    if (event.key === "Enter" && matches[active]) {
      event.preventDefault();
      pick(matches[active]);
    }
  };

  const handleAnimationEnd = (
    event: React.AnimationEvent<HTMLDialogElement>
  ) => {
    if (event.target !== event.currentTarget) return;

    if (event.animationName === "chat-window-picker-reveal") {
      setIsSettled(true);
    } else if (event.animationName === "chat-window-picker-hide") {
      setPhase((current) => (current === "closing" ? "closed" : current));
    }
  };

  const getEmptyText = () =>
    normalizedQuery
      ? t("no_friends_match", { query: query.trim() })
      : t("no_friends_to_message");

  return (
    <div className="chat-window__new-conversation" ref={containerRef}>
      <button
        ref={buttonRef}
        type="button"
        className={cn("chat-window__new-conversation-button", {
          "chat-window__new-conversation-button--open": isOpen,
        })}
        onClick={toggle}
        title={t("new_conversation_shortcut")}
        aria-label={t("new_conversation")}
        aria-haspopup="dialog"
        aria-expanded={isOpen}
      >
        <PlusIcon size={14} />
      </button>

      {phase !== "closed" && placement && (
        <dialog
          open
          className={cn("chat-window__picker", {
            "chat-window__picker--closing": phase === "closing",
            "chat-window__picker--settled": isSettled,
          })}
          aria-label={t("new_conversation")}
          style={
            {
              left: placement.left,
              "--chat-picker-clip-left": `${placement.clipLeft}px`,
              "--chat-picker-clip-right": `${placement.clipRight}px`,
            } as React.CSSProperties
          }
          onAnimationEnd={handleAnimationEnd}
        >
          <label className="chat-window__emoji-search chat-window__picker-search">
            <SearchIcon size={14} className="chat-window__emoji-search-icon" />
            <input
              ref={inputRef}
              type="text"
              className="chat-window__emoji-search-input"
              value={query}
              onChange={(event) => {
                setQuery(event.target.value);
                setActiveIndex(0);
              }}
              placeholder={t("search_friends")}
              aria-label={t("search_friends")}
              onKeyDown={handleSearchKeyDown}
            />
          </label>

          <span className="chat-window__picker-title">{t("friends")}</span>

          {matches.length === 0 ? (
            <p className="chat-window__picker-empty">{getEmptyText()}</p>
          ) : (
            <div className="chat-window__picker-list">
              <div className="chat-window__picker-options">
                <span
                  className="chat-window__picker-highlight"
                  style={{
                    transform: `translateY(${active * OPTION_HEIGHT}px)`,
                  }}
                  aria-hidden="true"
                />
                {matches.map((friend, index) => (
                  <button
                    key={friend.id}
                    ref={(element) => {
                      optionRefs.current[index] = element;
                    }}
                    type="button"
                    className="chat-window__picker-option"
                    style={
                      {
                        "--chat-picker-option-index": Math.min(
                          index,
                          MAX_STAGGERED_OPTIONS
                        ),
                      } as React.CSSProperties
                    }
                    onPointerMove={() => setActiveIndex(index)}
                    onClick={() => pick(friend)}
                  >
                    <ChatFriendAvatar friend={friend} size={24} />
                    <span className="chat-window__picker-details">
                      <span className="chat-window__picker-name">
                        {highlightMatch(friend.displayName, normalizedQuery)}
                      </span>
                      <ChatFriendStatus friend={friend} />
                    </span>
                    {openFriendIds.has(friend.id) && (
                      <span className="chat-window__picker-open">
                        {t("open_tab")}
                      </span>
                    )}
                  </button>
                ))}
              </div>
            </div>
          )}
        </dialog>
      )}
    </div>
  );
}
