import { useDeferredValue, useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { useLocation, useNavigate } from "react-router-dom";
import { SearchIcon, XIcon } from "@primer/octicons-react";
import { debounce } from "lodash-es";
import cn from "classnames";

import {
  useAppDispatch,
  useAppSelector,
  useSearchHistory,
  useSearchSuggestions,
} from "@renderer/hooks";
import type { SuggestionShop } from "@renderer/hooks/use-search-suggestions";
import { setFilters, setLibrarySearchQuery } from "@renderer/features";
import { buildGameDetailsPath } from "@renderer/helpers";
import type { GameShop } from "@types";

import { SearchDropdown } from "../search-dropdown/search-dropdown";

const MAX_QUERY_LENGTH = 255;

/**
 * The search in the middle of the title bar. On the library it filters the
 * library; everywhere else it searches the catalogue and suggests games.
 */
export function TitleBarSearch() {
  const inputRef = useRef<HTMLInputElement>(null);
  const searchContainerRef = useRef<HTMLDivElement>(null);

  const navigate = useNavigate();
  const location = useLocation();
  const dispatch = useAppDispatch();
  const { t } = useTranslation("header");

  const isOnLibraryPage = location.pathname.startsWith("/library");
  const isOnCataloguePage = location.pathname.startsWith("/catalogue");

  const catalogueSearchValue = useAppSelector(
    (state) => state.catalogueSearch.filters.title
  );
  const librarySearchValue = useAppSelector(
    (state) => state.library.searchQuery
  );

  const searchValue = isOnLibraryPage
    ? librarySearchValue
    : catalogueSearchValue;

  const [localSearchValue, setLocalSearchValue] = useState(searchValue);
  const deferredSearchValue = useDeferredValue(localSearchValue);

  const [isFocused, setIsFocused] = useState(false);
  const [isDropdownVisible, setIsDropdownVisible] = useState(false);
  const [activeIndex, setActiveIndex] = useState(-1);
  const [dropdownPosition, setDropdownPosition] = useState({ x: 0, y: 0 });
  const [dropdownWidth, setDropdownWidth] = useState(0);
  const [suggestionShop, setSuggestionShop] = useState<SuggestionShop>("steam");

  const debouncedLibrarySearch = useMemo(
    () =>
      debounce((value: string) => {
        dispatch(setLibrarySearchQuery(value));
      }, 180),
    [dispatch]
  );

  const debouncedCatalogueSearch = useMemo(
    () =>
      debounce((value: string) => {
        dispatch(setFilters({ title: value }));
      }, 250),
    [dispatch]
  );

  const { addToHistory, removeFromHistory, clearHistory, getRecentHistory } =
    useSearchHistory();

  const { suggestions, isLoading: isLoadingSuggestions } = useSearchSuggestions(
    deferredSearchValue,
    isOnLibraryPage,
    isDropdownVisible && isFocused && !isOnCataloguePage,
    suggestionShop
  );

  const historyItems = getRecentHistory(
    isOnLibraryPage ? "library" : "catalogue",
    3
  );

  const totalItems = historyItems.length + suggestions.length;

  useEffect(() => {
    setLocalSearchValue(searchValue);
  }, [searchValue, isOnLibraryPage, isOnCataloguePage]);

  useEffect(() => {
    return () => {
      debouncedLibrarySearch.cancel();
      debouncedCatalogueSearch.cancel();
    };
  }, [debouncedCatalogueSearch, debouncedLibrarySearch]);

  const updateDropdownPosition = () => {
    if (!searchContainerRef.current) return;

    const rect = searchContainerRef.current.getBoundingClientRect();
    setDropdownPosition({ x: rect.left, y: rect.bottom });
    setDropdownWidth(rect.width);
  };

  useEffect(() => {
    if (!isDropdownVisible) return;

    window.addEventListener("resize", updateDropdownPosition);
    return () => window.removeEventListener("resize", updateDropdownPosition);
  }, [isDropdownVisible]);

  const handleFocus = () => {
    if (isFocused && isDropdownVisible) {
      updateDropdownPosition();
      return;
    }

    setIsFocused(true);
    setActiveIndex(-1);
    updateDropdownPosition();
    setIsDropdownVisible(true);
  };

  const handleBlur = () => {
    // Lets a click on the dropdown land before it closes.
    setTimeout(() => {
      setIsFocused(false);
      setIsDropdownVisible(false);
      setActiveIndex(-1);
    }, 200);
  };

  const applySearch = (value: string) => {
    debouncedLibrarySearch.cancel();
    debouncedCatalogueSearch.cancel();

    const query = value.slice(0, MAX_QUERY_LENGTH);

    if (isOnLibraryPage) {
      dispatch(setLibrarySearchQuery(query));
    } else {
      dispatch(setFilters({ title: query }));
    }
    setActiveIndex(-1);
  };

  const handleInputChange = (value: string) => {
    const query = value.slice(0, MAX_QUERY_LENGTH);

    setLocalSearchValue(query);
    setActiveIndex(-1);

    if (isOnLibraryPage) {
      debouncedCatalogueSearch.cancel();
      debouncedLibrarySearch(query);
    } else {
      debouncedLibrarySearch.cancel();
      debouncedCatalogueSearch(query);
    }
  };

  const executeSearch = (query: string) => {
    setLocalSearchValue(query.slice(0, MAX_QUERY_LENGTH));

    if (query.trim()) {
      addToHistory(query, isOnLibraryPage ? "library" : "catalogue");
    }
    applySearch(query);

    if (!isOnLibraryPage && !isOnCataloguePage) {
      navigate("/catalogue");
    }

    setIsDropdownVisible(false);
    inputRef.current?.blur();
  };

  const handleSelectSuggestion = (suggestion: {
    title: string;
    objectId: string;
    shop: GameShop;
  }) => {
    setIsDropdownVisible(false);
    inputRef.current?.blur();
    navigate(buildGameDetailsPath(suggestion));
  };

  const handleClearSearch = () => {
    setLocalSearchValue("");
    applySearch("");
  };

  const handleKeyDown = (event: React.KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "Enter") {
      event.preventDefault();

      if (activeIndex >= 0 && activeIndex < totalItems) {
        if (activeIndex < historyItems.length) {
          executeSearch(historyItems[activeIndex].query);
        } else {
          handleSelectSuggestion(
            suggestions[activeIndex - historyItems.length]
          );
        }
      } else if (localSearchValue.trim()) {
        executeSearch(localSearchValue);
      }
    } else if (event.key === "ArrowDown") {
      event.preventDefault();
      setActiveIndex((prev) => (prev < totalItems - 1 ? prev + 1 : prev));

      if (!isDropdownVisible) {
        setIsDropdownVisible(true);
        updateDropdownPosition();
      }
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      setActiveIndex((prev) => (prev > -1 ? prev - 1 : -1));
    } else if (event.key === "Escape") {
      event.preventDefault();
      setIsDropdownVisible(false);
      setActiveIndex(-1);
      inputRef.current?.blur();
    }
  };

  const placeholder = isOnLibraryPage ? t("search_library") : t("search");

  return (
    <>
      <div
        ref={searchContainerRef}
        className={cn("title-bar-search", {
          "title-bar-search--focused": isFocused,
        })}
      >
        <SearchIcon size={14} className="title-bar-search__icon" />

        <input
          ref={inputRef}
          type="text"
          name="search"
          placeholder={placeholder}
          aria-label={placeholder}
          value={localSearchValue}
          className="title-bar-search__input"
          onChange={(event) => handleInputChange(event.target.value)}
          onFocus={handleFocus}
          onBlur={handleBlur}
          onKeyDown={handleKeyDown}
        />

        {localSearchValue && (
          <button
            type="button"
            className="title-bar-search__clear"
            // Keeps the focus in the field.
            onMouseDown={(event) => event.preventDefault()}
            onClick={handleClearSearch}
            aria-label={t("clear_search")}
          >
            <XIcon size={12} />
          </button>
        )}
      </div>

      <SearchDropdown
        visible={
          isDropdownVisible &&
          (localSearchValue.trim().length > 0 ||
            historyItems.length > 0 ||
            suggestions.length > 0 ||
            isLoadingSuggestions)
        }
        position={dropdownPosition}
        width={dropdownWidth}
        historyItems={historyItems}
        suggestions={suggestions}
        isLoadingSuggestions={isLoadingSuggestions}
        suggestionShop={suggestionShop}
        onSuggestionShopChange={setSuggestionShop}
        showShopSwitch={!isOnLibraryPage}
        onSelectHistory={executeSearch}
        onSelectSuggestion={handleSelectSuggestion}
        onRemoveHistoryItem={removeFromHistory}
        onClearHistory={clearHistory}
        onClose={() => {
          setIsDropdownVisible(false);
          setActiveIndex(-1);
        }}
        activeIndex={activeIndex}
        currentQuery={deferredSearchValue}
        searchContainerRef={searchContainerRef}
      />
    </>
  );
}
