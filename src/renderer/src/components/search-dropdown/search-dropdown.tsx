import { useEffect, useRef } from "react";
import { createPortal } from "react-dom";
import { ClockIcon, SearchIcon, XIcon } from "@primer/octicons-react";
import { SearchCard } from "./search-card";
import { AnimatePresence, motion } from "framer-motion";

import { useTranslation } from "react-i18next";
import type { SearchHistoryEntry } from "@renderer/hooks/use-search-history";
import type { SearchSuggestion } from "@renderer/hooks/use-search-suggestions";
import { useGamepad, useGamepadConnected } from "@renderer/hooks/use-gamepad";
import { GradualBlur } from "../ui/gradual-blur";
import "./search-dropdown.scss";

export interface SearchDropdownProps {
  visible: boolean;
  historyItems: SearchHistoryEntry[];
  suggestions: SearchSuggestion[];
  isLoadingSuggestions: boolean;
  onSelectHistory: (query: string) => void;
  onSelectSuggestion: (suggestion: SearchSuggestion) => void;
  onRemoveHistoryItem: (query: string) => void;
  onClearHistory: () => void;
  onClose: () => void;
  searchValue: string;
  onSearchChange: (val: string) => void;
  onExecuteSearch: () => void;
  placeholder?: string;
}

export function SearchDropdown({
  visible,
  historyItems,
  suggestions,
  isLoadingSuggestions,
  onSelectHistory,
  onSelectSuggestion,
  onRemoveHistoryItem,
  onClearHistory,
  onClose,
  searchValue,
  onSearchChange,
  onExecuteSearch,
  placeholder,
}: SearchDropdownProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const { t } = useTranslation("header");
  const isGamepadConnected = useGamepadConnected();

  const dragRef = useRef({
    isDragging: false,
    startX: 0,
    scrollLeft: 0,
    hasDragged: false,
  });

  useEffect(() => {
    if (visible && inputRef.current) {
      setTimeout(() => {
        inputRef.current?.focus();
        if (isGamepadConnected) {
          window.electron.showVirtualKeyboard?.();
          window.dispatchEvent(new CustomEvent("hydra:open-keyboard"));
        }
      }, 50);
    }
  }, [visible, isGamepadConnected]);

  useEffect(() => {
    if (!visible) return;

    const handleClickOutside = (event: MouseEvent) => {
      const target = event.target as Node;
      if (containerRef.current && !containerRef.current.contains(target)) {
        onClose();
      }
    };

    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };

    document.addEventListener("mousedown", handleClickOutside);
    document.addEventListener("keydown", handleEscape);
    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
      document.removeEventListener("keydown", handleEscape);
    };
  }, [visible, onClose]);

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter") {
      e.preventDefault();
      const firstCard = containerRef.current?.querySelector<HTMLElement>(
        ".search-dropdown__card, .search-dropdown__tag"
      );
      if (isGamepadConnected && firstCard) {
        firstCard.focus();
      } else {
        onExecuteSearch();
      }
    }
    if (e.key === "ArrowDown") {
      e.preventDefault();
      containerRef.current
        ?.querySelector<HTMLElement>(".search-dropdown__card")
        ?.focus();
    }
  };

  useGamepad({
    priority: 15,
    onButton: {
      B: () => {
        onClose();
        return true;
      },
      START: () => {
        const firstCard = containerRef.current?.querySelector<HTMLElement>(
          ".search-dropdown__card, .search-dropdown__tag"
        );
        if (firstCard) {
          firstCard.focus();
        } else {
          onExecuteSearch();
        }
        return true;
      },
    },
  });

  const hasHistory = historyItems.length > 0;
  const hasSuggestions = suggestions.length > 0;

  const dropdownContent = (
    <>
      <AnimatePresence>
        {visible && (
          <motion.div
            key="blur-bg"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.25, ease: "easeInOut" }}
            style={{
              position: "fixed",
              top: 0,
              left: 0,
              width: "100vw",
              height: "100vh",
              zIndex: 999,
              pointerEvents: "none",
            }}
          >
            <div
              style={{
                position: "absolute",
                top: 0,
                left: 0,
                width: "100%",
                height: "60vh",
                background:
                  "linear-gradient(to bottom, rgba(0,0,0,0.85) 0%, rgba(0,0,0,0.6) 40%, transparent 100%)",
                zIndex: 1,
              }}
            />
            <GradualBlur
              position="top"
              height="60vh"
              strength={3.5}
              divCount={8}
              curve="ease-out"
              exponential
              style={{
                position: "absolute",
                top: 0,
                left: 0,
                width: "100%",
                zIndex: 0,
                pointerEvents: "none",
              }}
            />
          </motion.div>
        )}
      </AnimatePresence>

      <AnimatePresence>
        {visible && (
          <motion.div
            className="search-dropdown"
            initial={{ opacity: 0, filter: "blur(10px)" }}
            animate={{ opacity: 1, filter: "blur(0px)" }}
            exit={{ opacity: 0, filter: "blur(10px)", pointerEvents: "none" }}
            transition={{ duration: 0.15, ease: "easeOut" }}
          >
            <div className="search-dropdown__content" ref={containerRef}>
              <div className="search-dropdown__input-container">
                <SearchIcon
                  size={16}
                  className="search-dropdown__search-icon"
                />
                <input
                  ref={inputRef}
                  type="text"
                  className="search-dropdown__input"
                  value={searchValue}
                  onChange={(e) => onSearchChange(e.target.value)}
                  onKeyDown={handleKeyDown}
                  placeholder={placeholder}
                />
                {searchValue && (
                  <button
                    className="search-dropdown__clear-button"
                    onClick={() => {
                      onSearchChange("");
                      inputRef.current?.focus();
                    }}
                  >
                    <XIcon size={14} />
                  </button>
                )}
              </div>

              {hasSuggestions && (
                <div style={{ width: "100%" }}>
                  <span
                    className="search-dropdown__section-title"
                    style={{ padding: "0 32px" }}
                  >
                    {t("suggestions")}
                  </span>
                  <div
                    className="search-dropdown__cards-scroll"
                    role="presentation"
                    onMouseDown={(e) => {
                      dragRef.current.isDragging = true;
                      dragRef.current.startX =
                        e.pageX - e.currentTarget.offsetLeft;
                      dragRef.current.scrollLeft = e.currentTarget.scrollLeft;
                      dragRef.current.hasDragged = false;
                      e.currentTarget.style.scrollBehavior = "auto";
                      e.currentTarget.style.cursor = "grabbing";
                    }}
                    onMouseLeave={(e) => {
                      dragRef.current.isDragging = false;
                      e.currentTarget.style.scrollBehavior = "";
                      e.currentTarget.style.cursor = "";
                    }}
                    onMouseUp={(e) => {
                      dragRef.current.isDragging = false;
                      e.currentTarget.style.scrollBehavior = "";
                      e.currentTarget.style.cursor = "";
                    }}
                    onMouseMove={(e) => {
                      if (!dragRef.current.isDragging) return;
                      e.preventDefault();
                      const x = e.pageX - e.currentTarget.offsetLeft;
                      const walk = x - dragRef.current.startX;
                      if (Math.abs(walk) > 5) dragRef.current.hasDragged = true;
                      e.currentTarget.scrollLeft =
                        dragRef.current.scrollLeft - walk;
                    }}
                  >
                    {suggestions.map((item) => (
                      <SearchCard
                        key={`${item.objectId}-${item.shop}`}
                        item={item}
                        isActive={false}
                        onClick={() => {
                          if (dragRef.current.hasDragged) return;
                          onSelectSuggestion(item);
                        }}
                      />
                    ))}
                  </div>
                </div>
              )}

              {!hasSuggestions && hasHistory && (
                <div
                  style={{
                    width: "440px",
                    alignSelf: "center",
                    display: "flex",
                    flexDirection: "column",
                    gap: 12,
                  }}
                >
                  <div
                    style={{
                      display: "flex",
                      justifyContent: "space-between",
                      alignItems: "center",
                    }}
                  >
                    <span
                      className="search-dropdown__section-title"
                      style={{
                        margin: 0,
                        fontSize: 12,
                        fontWeight: 400,
                        textTransform: "none",
                        letterSpacing: "normal",
                      }}
                    >
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
                  <div
                    style={{
                      display: "flex",
                      flexWrap: "wrap",
                      gap: 8,
                      justifyContent: "flex-start",
                    }}
                  >
                    {historyItems.map((item) => (
                      <button
                        key={`history-${item.query}-${item.timestamp}`}
                        type="button"
                        className="search-dropdown__tag"
                        onClick={() => onSelectHistory(item.query)}
                      >
                        <ClockIcon size={14} fill="rgba(255,255,255,0.4)" />
                        <span
                          style={{
                            maxWidth: 200,
                            overflow: "hidden",
                            textOverflow: "ellipsis",
                            whiteSpace: "nowrap",
                          }}
                        >
                          {item.query}
                        </span>
                        <div
                          role="button"
                          tabIndex={0}
                          className="search-dropdown__tag-close"
                          onClick={(e) => {
                            e.stopPropagation();
                            onRemoveHistoryItem(item.query);
                          }}
                          onKeyDown={(e) => {
                            if (e.key === "Enter" || e.key === " ") {
                              e.stopPropagation();
                              onRemoveHistoryItem(item.query);
                            }
                          }}
                        >
                          <XIcon size={12} />
                        </div>
                      </button>
                    ))}
                  </div>
                </div>
              )}

              {isLoadingSuggestions && !hasSuggestions && !hasHistory && (
                <div className="search-dropdown__loading">{t("loading")}</div>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </>
  );

  return createPortal(dropdownContent, document.body);
}
