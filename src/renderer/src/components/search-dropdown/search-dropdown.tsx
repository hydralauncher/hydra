import { useEffect, useId, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Tooltip } from "react-tooltip";
import {
  ClockIcon,
  DeviceDesktopIcon,
  SearchIcon,
  XIcon,
} from "@primer/octicons-react";
import cn from "classnames";
import { useTranslation } from "react-i18next";
import type { SearchHistoryEntry } from "@renderer/hooks/use-search-history";
import type {
  SearchSuggestion,
  SuggestionShop,
} from "@renderer/hooks/use-search-suggestions";
import { ClassicsIcon } from "@renderer/pages/library/category-filter";
import { HighlightText } from "./highlight-text";
import "./search-dropdown.scss";

export interface SearchDropdownProps {
  visible: boolean;
  position: { x: number; y: number };
  historyItems: SearchHistoryEntry[];
  suggestions: SearchSuggestion[];
  isLoadingSuggestions: boolean;
  suggestionShop: SuggestionShop;
  onSuggestionShopChange: (shop: SuggestionShop) => void;
  showShopSwitch: boolean;
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
  suggestionShop,
  onSuggestionShopChange,
  showShopSwitch,
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
  const shopTooltipId = useId();

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

  if (!visible) return null;

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
    <>
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
                className="search-dropdown__clear-text-button"
                onClick={onClearHistory}
              >
                {t("clear_history")}
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
                    onClick={() => onSelectHistory(item.query)}
                  >
                    <ClockIcon
                      size={16}
                      className="search-dropdown__item-icon"
                    />
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

        {(hasSuggestions || isLoadingSuggestions) && (
          <div className="search-dropdown__section">
            <div className="search-dropdown__section-header">
              <span className="search-dropdown__section-title">
                {t("suggestions")}
              </span>
              {showShopSwitch && (
                <div className="search-dropdown__shop-switch">
                  <button
                    type="button"
                    className={cn("search-dropdown__shop-button", {
                      "search-dropdown__shop-button--active":
                        suggestionShop === "steam",
                    })}
                    onMouseDown={(e) => e.preventDefault()}
                    onClick={() => onSuggestionShopChange("steam")}
                    aria-label="PC"
                    data-tooltip-id={shopTooltipId}
                    data-tooltip-content="PC"
                  >
                    <DeviceDesktopIcon size={14} />
                  </button>
                  <button
                    type="button"
                    className={cn("search-dropdown__shop-button", {
                      "search-dropdown__shop-button--active":
                        suggestionShop === "launchbox",
                    })}
                    onMouseDown={(e) => e.preventDefault()}
                    onClick={() => onSuggestionShopChange("launchbox")}
                    aria-label="Classics"
                    data-tooltip-id={shopTooltipId}
                    data-tooltip-content="Classics"
                  >
                    <ClassicsIcon size={16} />
                  </button>
                </div>
              )}
            </div>
            {hasSuggestions ? (
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
                      onClick={() => onSelectSuggestion(item)}
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
            ) : (
              <div className="search-dropdown__loading">{t("loading")}</div>
            )}
          </div>
        )}
      </div>

      <Tooltip id={shopTooltipId} place="bottom" style={{ zIndex: 1001 }} />
    </>
  );

  return createPortal(dropdownContent, document.body);
}
