import { useEffect, useMemo, useRef, useState, type RefObject } from "react";
import { useTranslation } from "react-i18next";
import {
  ClockIcon,
  GlobeIcon,
  HeartIcon,
  LightBulbIcon,
  SearchIcon,
  SmileyIcon,
  SquirrelIcon,
  TrophyIcon,
  XIcon,
  type Icon,
} from "@primer/octicons-react";
import cn from "classnames";

import {
  DEFAULT_RECENT_EMOJI,
  EMOJI_CATEGORIES,
  addRecentEmoji,
  findEmoji,
  searchEmoji,
  type EmojiCategoryId,
  type EmojiItem,
} from "./chat-emoji";

const RECENT_EMOJI_STORAGE_KEY = "chat-window:recent-emoji";
const GRID_COLUMNS = 8;

const CATEGORY_ICONS: Record<EmojiCategoryId, Icon> = {
  recent: ClockIcon,
  people: SmileyIcon,
  nature: SquirrelIcon,
  activity: TrophyIcon,
  travel: GlobeIcon,
  objects: LightBulbIcon,
  symbols: HeartIcon,
};

const CATEGORY_IDS: EmojiCategoryId[] = [
  "recent",
  ...EMOJI_CATEGORIES.map((category) => category.id),
];

const loadRecentEmoji = (): string[] => {
  try {
    const stored = JSON.parse(
      localStorage.getItem(RECENT_EMOJI_STORAGE_KEY) ?? "null"
    ) as unknown;
    if (
      Array.isArray(stored) &&
      stored.length > 0 &&
      stored.every((emoji) => typeof emoji === "string")
    ) {
      return stored;
    }
  } catch {
    // Unreadable storage falls back to the defaults.
  }
  return DEFAULT_RECENT_EMOJI;
};

/** Moves `emoji` to the front of the picker's Recent tab. */
export const rememberEmoji = (emoji: string) => {
  try {
    localStorage.setItem(
      RECENT_EMOJI_STORAGE_KEY,
      JSON.stringify(addRecentEmoji(loadRecentEmoji(), emoji))
    );
  } catch {
    // Recents are a convenience; picking still works without them.
  }
};

export interface ChatEmojiPickerProps {
  label: string;
  className?: string;
  /** The emoji already chosen, marked in the grid. */
  selected?: string | null;
  /** Clicks here don't dismiss the picker, so its toggle button can close it. */
  anchorRef?: RefObject<HTMLElement | null>;
  onPick: (emoji: string) => void;
  onClose: () => void;
}

export function ChatEmojiPicker({
  label,
  className,
  selected = null,
  anchorRef,
  onPick,
  onClose,
}: Readonly<ChatEmojiPickerProps>) {
  const { t } = useTranslation("chat_window");

  const rootRef = useRef<HTMLDialogElement>(null);
  const gridRef = useRef<HTMLDivElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);

  const [recent] = useState(loadRecentEmoji);
  const [tab, setTab] = useState<EmojiCategoryId>("recent");
  const [query, setQuery] = useState("");
  const [hovered, setHovered] = useState<string | null>(null);

  useEffect(() => {
    searchRef.current?.focus();
  }, []);

  useEffect(() => {
    const handlePointerDown = (event: MouseEvent) => {
      const target = event.target as Node;
      if (
        !rootRef.current?.contains(target) &&
        !anchorRef?.current?.contains(target)
      ) {
        onClose();
      }
    };

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };

    document.addEventListener("mousedown", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("mousedown", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [anchorRef, onClose]);

  const isSearching = query.trim().length > 0;

  const items: EmojiItem[] = useMemo(() => {
    if (isSearching) return searchEmoji(query);
    if (tab === "recent") return recent.map(findEmoji);
    return (
      EMOJI_CATEGORIES.find((category) => category.id === tab)?.items ?? []
    );
  }, [isSearching, query, recent, tab]);

  const footer =
    items.find((item) => item.emoji === hovered) ?? items[0] ?? null;

  const pick = (emoji: string) => {
    rememberEmoji(emoji);
    onPick(emoji);
  };

  const focusGridItem = (index: number) => {
    const buttons = gridRef.current?.querySelectorAll("button");
    if (!buttons?.length) return;
    buttons[Math.max(0, Math.min(index, buttons.length - 1))].focus();
  };

  const handleGridKeyDown = (event: React.KeyboardEvent<HTMLButtonElement>) => {
    const buttons = [...(gridRef.current?.querySelectorAll("button") ?? [])];
    const index = buttons.indexOf(document.activeElement as HTMLButtonElement);
    if (index === -1) return;

    const moves: Record<string, number> = {
      ArrowLeft: -1,
      ArrowRight: 1,
      ArrowUp: -GRID_COLUMNS,
      ArrowDown: GRID_COLUMNS,
    };
    const move = moves[event.key];
    if (move === undefined) return;

    event.preventDefault();
    if (event.key === "ArrowUp" && index < GRID_COLUMNS) {
      searchRef.current?.focus();
      return;
    }
    focusGridItem(index + move);
  };

  const handleSearchKeyDown = (
    event: React.KeyboardEvent<HTMLInputElement>
  ) => {
    if (event.key === "Enter" && items[0]) {
      event.preventDefault();
      pick(items[0].emoji);
    } else if (event.key === "ArrowDown") {
      event.preventDefault();
      focusGridItem(0);
    }
  };

  const selectTab = (id: EmojiCategoryId) => {
    setTab(id);
    setQuery("");
    setHovered(null);
    if (gridRef.current) gridRef.current.scrollTop = 0;
  };

  const sectionTitle = isSearching
    ? t("emoji_search_results")
    : t(`emoji_category_${tab}`);

  return (
    <dialog
      ref={rootRef}
      className={cn("chat-window__emoji-picker", className)}
      open
      aria-label={label}
    >
      <div className="chat-window__emoji-search">
        <SearchIcon size={14} className="chat-window__emoji-search-icon" />
        <input
          ref={searchRef}
          className="chat-window__emoji-search-input"
          type="text"
          value={query}
          placeholder={t("emoji_search")}
          aria-label={t("emoji_search")}
          onChange={(event) => {
            setQuery(event.target.value);
            setHovered(null);
          }}
          onKeyDown={handleSearchKeyDown}
        />
        {query && (
          <button
            type="button"
            className="chat-window__emoji-search-clear"
            onClick={() => {
              setQuery("");
              searchRef.current?.focus();
            }}
            aria-label={t("emoji_clear_search")}
          >
            <XIcon size={12} />
          </button>
        )}
      </div>

      <div
        className="chat-window__emoji-tabs"
        role="tablist"
        aria-label={t("emoji_categories")}
      >
        {CATEGORY_IDS.map((id) => {
          const CategoryIcon = CATEGORY_ICONS[id];
          const isActive = !isSearching && tab === id;

          return (
            <button
              key={id}
              type="button"
              role="tab"
              className={cn("chat-window__emoji-tab", {
                "chat-window__emoji-tab--active": isActive,
              })}
              aria-selected={isActive}
              aria-label={t(`emoji_category_${id}`)}
              title={t(`emoji_category_${id}`)}
              onClick={() => selectTab(id)}
            >
              <CategoryIcon size={16} />
            </button>
          );
        })}
      </div>

      <div ref={gridRef} className="chat-window__emoji-body">
        <div className="chat-window__emoji-section-title">{sectionTitle}</div>

        {items.length > 0 ? (
          <fieldset
            className="chat-window__emoji-grid"
            aria-label={sectionTitle}
          >
            {items.map((item) => (
              <button
                key={item.emoji}
                type="button"
                className={cn("chat-window__emoji-option", {
                  "chat-window__emoji-option--selected":
                    item.emoji === selected,
                })}
                aria-label={item.name.replaceAll("_", " ")}
                aria-pressed={item.emoji === selected}
                onClick={() => pick(item.emoji)}
                onKeyDown={handleGridKeyDown}
                onMouseEnter={() => setHovered(item.emoji)}
                onFocus={() => setHovered(item.emoji)}
              >
                <span className="chat-window__emoji-glyph">{item.emoji}</span>
              </button>
            ))}
          </fieldset>
        ) : (
          <div className="chat-window__emoji-empty">
            <p className="chat-window__emoji-empty-title">
              {t("emoji_no_results_title")}
            </p>
            <p className="chat-window__emoji-empty-description">
              {t("emoji_no_results_description", { query: query.trim() })}
            </p>
          </div>
        )}
      </div>

      <div className="chat-window__emoji-footer" aria-hidden="true">
        {footer && (
          <>
            <span className="chat-window__emoji-glyph chat-window__emoji-footer-glyph">
              {footer.emoji}
            </span>
            <span className="chat-window__emoji-footer-name">
              :{footer.name}:
            </span>
          </>
        )}
      </div>
    </dialog>
  );
}
