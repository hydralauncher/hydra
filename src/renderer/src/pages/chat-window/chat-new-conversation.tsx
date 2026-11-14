import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { ArrowLeftIcon, SearchIcon } from "@primer/octicons-react";
import cn from "classnames";

import type { UserFriend } from "@types";
import { BACKGROUND_IMAGE_SIZES } from "@renderer/pages/friends-window/friends-window-layout";

import { ChatFriendAvatar, ChatFriendStatus } from "./chat-friend-status";

/** Rows past this one fade in together, so a long list doesn't lag. */
const MAX_STAGGERED_OPTIONS = 8;
/** Once the staggered entrance is over, rows a search brings in show at once. */
const SETTLE_MS = 400;

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

const PICKER_BANNER_IMAGE_OPTIONS = {
  ...BACKGROUND_IMAGE_SIZES.friend,
  preserveAnimation: true,
};

function usePickerBanner(imageUrl: string | null | undefined) {
  const [element, setElement] = useState<HTMLElement | null>(null);
  const [isVisible, setIsVisible] = useState(false);
  const [bannerUrl, setBannerUrl] = useState<string | null>(null);

  useEffect(() => {
    if (!element || !imageUrl || isVisible) return;

    const observer = new IntersectionObserver((entries) => {
      if (entries.some((entry) => entry.isIntersecting)) setIsVisible(true);
    });
    observer.observe(element);

    return () => observer.disconnect();
  }, [element, imageUrl, isVisible]);

  useEffect(() => {
    if (!isVisible || !imageUrl) {
      setBannerUrl(null);
      return;
    }

    if (typeof globalThis.electron.getProcessedImage !== "function") {
      setBannerUrl(imageUrl);
      return;
    }

    let cancelled = false;
    globalThis.electron
      .getProcessedImage(imageUrl, PICKER_BANNER_IMAGE_OPTIONS)
      .then((processedUrl) => {
        if (!cancelled) setBannerUrl(processedUrl ?? imageUrl);
      })
      .catch(() => {
        if (!cancelled) setBannerUrl(imageUrl);
      });

    return () => {
      cancelled = true;
    };
  }, [imageUrl, isVisible]);

  return { observe: setElement, bannerUrl };
}

interface ChatPickerOptionProps {
  friend: UserFriend;
  index: number;
  isActive: boolean;
  isOpen: boolean;
  query: string;
  openLabel: string;
  optionRefs: React.MutableRefObject<(HTMLButtonElement | null)[]>;
  onHover: (index: number) => void;
  onPick: (friend: UserFriend) => void;
}

function ChatPickerOption({
  friend,
  index,
  isActive,
  isOpen,
  query,
  openLabel,
  optionRefs,
  onHover,
  onPick,
}: Readonly<ChatPickerOptionProps>) {
  const { observe, bannerUrl } = usePickerBanner(friend.backgroundImageUrl);
  const setButton = useCallback(
    (element: HTMLButtonElement | null) => {
      optionRefs.current[index] = element;
      observe(element);
    },
    [index, observe, optionRefs]
  );

  return (
    <button
      ref={setButton}
      type="button"
      role="option"
      aria-selected={isActive}
      className={cn("chat-window__picker-option", {
        "chat-window__picker-option--banner": bannerUrl,
        "chat-window__picker-option--active": isActive,
      })}
      style={
        {
          "--chat-picker-option-index": Math.min(index, MAX_STAGGERED_OPTIONS),
        } as React.CSSProperties
      }
      onPointerMove={() => onHover(index)}
      onClick={() => onPick(friend)}
    >
      {bannerUrl && (
        <img
          className="chat-window__picker-banner"
          src={bannerUrl}
          alt=""
          decoding="async"
        />
      )}
      <ChatFriendAvatar friend={friend} size={32} />
      <span className="chat-window__picker-details">
        <span className="chat-window__picker-name">
          {highlightMatch(friend.displayName, query)}
        </span>
        <ChatFriendStatus friend={friend} />
      </span>
      {isOpen && <span className="chat-window__picker-open">{openLabel}</span>}
    </button>
  );
}

export interface ChatNewConversationPanelProps {
  friends: UserFriend[];
  openFriendIds: Set<string>;
  onPick: (friend: UserFriend) => void;
  /** Back to the conversation list without picking anyone. */
  onClose: () => void;
}

/**
 * The friend picker, shown in place of the conversation list (Ctrl+T or the
 * sidebar's "+"). Escape or the back button returns to the list.
 */
export function ChatNewConversationPanel({
  friends,
  openFriendIds,
  onPick,
  onClose,
}: Readonly<ChatNewConversationPanelProps>) {
  const { t } = useTranslation("chat_window");

  const inputRef = useRef<HTMLInputElement>(null);
  const optionRefs = useRef<(HTMLButtonElement | null)[]>([]);

  const [query, setQuery] = useState("");
  const [activeIndex, setActiveIndex] = useState(0);
  const [isSettled, setIsSettled] = useState(false);

  useEffect(() => {
    inputRef.current?.focus();

    const timer = window.setTimeout(() => setIsSettled(true), SETTLE_MS);
    return () => window.clearTimeout(timer);
  }, []);

  // Escape works wherever focus is in the panel.
  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      onClose();
    };

    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [onClose]);

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
      onPick(matches[active]);
    }
  };

  const getEmptyText = () =>
    normalizedQuery
      ? t("no_friends_match", { query: query.trim() })
      : t("no_friends_to_message");

  return (
    <div
      className={cn("chat-window__picker", {
        "chat-window__picker--settled": isSettled,
      })}
      role="dialog"
      aria-label={t("new_conversation")}
    >
      <div className="chat-window__sidebar-header">
        <button
          type="button"
          className="chat-window__icon-button chat-window__icon-button--small"
          onClick={onClose}
          title={t("back_to_conversations_shortcut")}
          aria-label={t("back_to_conversations")}
        >
          <ArrowLeftIcon size={16} />
        </button>
        <h1 className="chat-window__sidebar-title">{t("new_conversation")}</h1>
      </div>

      <label className="chat-window__emoji-search chat-window__sidebar-search">
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
        <div
          className="chat-window__picker-list"
          role="listbox"
          aria-label={t("friends")}
        >
          {matches.map((friend, index) => (
            <ChatPickerOption
              key={friend.id}
              friend={friend}
              index={index}
              isActive={index === active}
              isOpen={openFriendIds.has(friend.id)}
              query={normalizedQuery}
              openLabel={t("open_conversation")}
              optionRefs={optionRefs}
              onHover={setActiveIndex}
              onPick={onPick}
            />
          ))}
        </div>
      )}

      <p className="chat-window__picker-hint">{t("picker_hint")}</p>
    </div>
  );
}
