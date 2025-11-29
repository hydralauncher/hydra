import { useEffect, useRef, useCallback, useState } from "react";
import { createPortal } from "react-dom";
import {
  ClockIcon,
  SearchIcon,
  TrashIcon,
  XIcon,
} from "@primer/octicons-react";
import cn from "classnames";
import { useTranslation } from "react-i18next";
import type { SearchHistoryEntry } from "@renderer/hooks/use-search-history";
import type { SearchSuggestion } from "@renderer/hooks/use-search-suggestions";
import { HighlightText } from "./highlight-text";
import "./search-dropdown.scss";

export interface SearchDropdownProps {
  visible: boolean;
  position: { x: number; y: number };
  historyItems: SearchHistoryEntry[];
  suggestions: SearchSuggestion[];
  isLoadingSuggestions: boolean;
  onSelectHistory: (query: string) => void;
  onSelectSuggestion: (suggestion: SearchSuggestion) => void;
  onRemoveHistoryItem: (query: string) => void;
  onClearHistory: () => void;
  onClose: () => void;
  activeIndex: number;
  currentQuery: string;
  searchContainerRef?: React.RefObject<HTMLDivElement>;
}

export function SearchDropdown({
  visible,
  position,
  historyItems,
  suggestions,
  isLoadingSuggestions,
  onSelectHistory,
  onSelectSuggestion,
  onRemoveHistoryItem,
  onClearHistory,
  onClose,
  activeIndex,
  currentQuery,
  searchContainerRef,
}: SearchDropdownProps) {
  const dropdownRef = useRef<HTMLDivElement>(null);
  const [adjustedPosition, setAdjustedPosition] = useState(position);
  const { t } = useTranslation("header");

  useEffect(() => {
    if (!visible) {
      setAdjustedPosition(position);
      return;
    }

    const checkPosition = () => {
      if (!dropdownRef.current) return;

      const rect = dropdownRef.current.getBoundingClientRect();
      const viewportWidth = window.innerWidth;
      const viewportHeight = window.innerHeight;

      let adjustedX = position.x;
      let adjustedY = position.y;

      if (adjustedX + 250 > viewportWidth - 10) {
        adjustedX = Math.max(10, viewportWidth - 250 - 10);
      }

      if (adjustedY + rect.height > viewportHeight - 10) {
        adjustedY = Math.max(10, viewportHeight - rect.height - 10);
      }

      setAdjustedPosition({ x: adjustedX, y: adjustedY });
    };

    requestAnimationFrame(checkPosition);
  }, [visible, position]);

  useEffect(() => {
    if (!visible) return;

    const handleClickOutside = (event: MouseEvent) => {
      const target = event.target as Node;

      if (
        dropdownRef.current &&
        !dropdownRef.current.contains(target) &&
        !searchContainerRef?.current?.contains(target)
      ) {
        onClose();
      }
    };

    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [visible, onClose, searchContainerRef]);

  const handleItemClick = useCallback(
    (
      type: "history" | "suggestion",
      item: SearchHistoryEntry | SearchSuggestion
    ) => {
      if (type === "history") {
        onSelectHistory((item as SearchHistoryEntry).query);
      } else {
        onSelectSuggestion(item as SearchSuggestion);
      }
    },
    [onSelectHistory, onSelectSuggestion]
  );

  if (!visible) return null;

  const totalItems = historyItems.length + suggestions.length;
  const hasHistory = historyItems.length > 0;
  const hasSuggestions = suggestions.length > 0;

  const getItemIndex = (
    section: "history" | "suggestion",
    indexInSection: number
  ) => {
    if (section === "history") {
      return indexInSection;
    }
    return historyItems.length + indexInSection;
  };

  const dropdownContent = (
    <div
      ref={dropdownRef}
      className="search-dropdown"
      style={{
        left: adjustedPosition.x,
        top: adjustedPosition.y,
      }}
    >
      {hasHistory && (
        <div className="search-dropdown__section">
          <div className="search-dropdown__section-header">
            <span className="search-dropdown__section-title">
              {t("recent_searches")}
            </span>
            <button
              type="button"
              className="search-dropdown__clear-button"
              onClick={onClearHistory}
              title={t("clear_history")}
            >
              <TrashIcon size={14} />
            </button>
          </div>
          <ul className="search-dropdown__list">
            {historyItems.map((item, index) => (
              <li
                key={`history-${item.query}-${item.timestamp}`}
                className="search-dropdown__item-container"
              >
                <button
                  type="button"
                  className={cn("search-dropdown__item", {
                    "search-dropdown__item--active":
                      activeIndex === getItemIndex("history", index),
                  })}
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => handleItemClick("history", item)}
                >
                  <ClockIcon size={16} className="search-dropdown__item-icon" />
                  <span className="search-dropdown__item-text">
                    {item.query}
                  </span>
                </button>
                <button
                  type="button"
                  className="search-dropdown__item-remove"
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={(e) => {
                    e.stopPropagation();
                    onRemoveHistoryItem(item.query);
                  }}
                  title={t("remove_from_history")}
                >
                  <XIcon size={12} />
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}

      {hasSuggestions && (
        <div className="search-dropdown__section">
          <div className="search-dropdown__section-header">
            <span className="search-dropdown__section-title">
              {t("suggestions")}
            </span>
          </div>
          <ul className="search-dropdown__list">
            {suggestions.map((item, index) => (
              <li key={`suggestion-${item.objectId}-${item.shop}`}>
                <button
                  type="button"
                  className={cn("search-dropdown__item", {
                    "search-dropdown__item--active":
                      activeIndex === getItemIndex("suggestion", index),
                  })}
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => handleItemClick("suggestion", item)}
                >
                  {item.iconUrl ? (
                    <img
                      src={item.iconUrl}
                      alt=""
                      className="search-dropdown__item-icon search-dropdown__item-icon--image"
                    />
                  ) : (
                    <SearchIcon
                      size={16}
                      className="search-dropdown__item-icon"
                    />
                  )}
                  <span className="search-dropdown__item-text">
                    <HighlightText text={item.title} query={currentQuery} />
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}

      {isLoadingSuggestions && !hasSuggestions && !hasHistory && (
        <div className="search-dropdown__loading">{t("loading")}</div>
      )}

      {!isLoadingSuggestions &&
        !hasHistory &&
        !hasSuggestions &&
        totalItems === 0 && (
          <div className="search-dropdown__empty">{t("no_results")}</div>
        )}
    </div>
  );

  return createPortal(dropdownContent, document.body);
}
