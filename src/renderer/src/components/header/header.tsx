import { useTranslation } from "react-i18next";
import {
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
} from "react";
import { useLocation, useNavigate, useSearchParams } from "react-router-dom";
import {
  ArrowLeftIcon,
  SearchIcon,
  SyncIcon,
  XIcon,
} from "@primer/octicons-react";
import { Tooltip } from "react-tooltip";

import {
  useAppDispatch,
  useAppSelector,
  useSearchHistory,
  useSearchSuggestions,
} from "@renderer/hooks";

import "./header.scss";
import { AutoUpdateSubHeader } from "./auto-update-sub-header";
import { ScanGamesModal } from "./scan-games-modal";
import { VirtualKeyboard } from "../virtual-keyboard/virtual-keyboard";
import { useGamepadContext } from "../../context/gamepad";
import { setFilters, setLibrarySearchQuery } from "@renderer/features";
import cn from "classnames";
import { SearchDropdown } from "@renderer/components";
import { buildGameDetailsPath } from "@renderer/helpers";
import type { GameShop } from "@types";

const pathTitle: Record<string, string> = {
  "/": "home",
  "/catalogue": "catalogue",
  "/library": "library",
  "/downloads": "downloads",
  "/settings": "settings",
};

export function Header() {
  const inputRef = useRef<HTMLInputElement>(null);
  const searchContainerRef = useRef<HTMLDivElement>(null);
  const scanButtonTooltipId = useId();

  const navigate = useNavigate();
  const location = useLocation();
  const [searchParams, setSearchParams] = useSearchParams();

  const { headerTitle, draggingDisabled } = useAppSelector(
    (state) => state.window
  );

  const catalogueSearchValue = useAppSelector(
    (state) => state.catalogueSearch.filters.title
  );

  const librarySearchValue = useAppSelector(
    (state) => state.library.searchQuery
  );

  const isOnLibraryPage = location.pathname.startsWith("/library");
  const isOnCataloguePage = location.pathname.startsWith("/catalogue");

  const searchValue = isOnLibraryPage
    ? librarySearchValue
    : catalogueSearchValue;

  const dispatch = useAppDispatch();

  const { isControllerMode, subscribe } = useGamepadContext();
  const [isVirtualKeyboardOpen, setIsVirtualKeyboardOpen] = useState(false);

  const [isFocused, setIsFocused] = useState(false);
  const [isDropdownVisible, setIsDropdownVisible] = useState(false);
  const [activeIndex, setActiveIndex] = useState(-1);
  const [dropdownPosition, setDropdownPosition] = useState({
    x: 0,
    y: 0,
  });
  const [showScanModal, setShowScanModal] = useState(false);
  const [isScanning, setIsScanning] = useState(false);
  const [scanResult, setScanResult] = useState<{
    foundGames: { title: string; executablePath: string }[];
    total: number;
  } | null>(null);

  const { t } = useTranslation("header");

  // Listen for global search focus event
  useEffect(() => {
    const handleFocusSearch = () => {
      focusInput();
      if (isControllerMode) {
        setIsVirtualKeyboardOpen(true);
      }
    };

    globalThis.addEventListener("hydra:focus-search", handleFocusSearch);
    return () =>
      globalThis.removeEventListener("hydra:focus-search", handleFocusSearch);
  }, [isControllerMode]);

  const handleInputClick = () => {
    if (isControllerMode) {
      setIsVirtualKeyboardOpen(true);
    }
  };

  const { addToHistory, removeFromHistory, clearHistory, getRecentHistory } =
    useSearchHistory();

  const { suggestions, isLoading: isLoadingSuggestions } = useSearchSuggestions(
    searchValue,
    isOnLibraryPage,
    isDropdownVisible && isFocused && !isOnCataloguePage
  );

  const historyItems = getRecentHistory(
    isOnLibraryPage ? "library" : "catalogue",
    3
  );

  const title = useMemo(() => {
    if (location.pathname.startsWith("/game")) return headerTitle;
    if (location.pathname.startsWith("/achievements")) return headerTitle;
    if (location.pathname.startsWith("/profile")) return headerTitle;
    if (location.pathname.startsWith("/notifications")) return headerTitle;
    if (location.pathname.startsWith("/library"))
      return headerTitle || t("library");
    if (location.pathname.startsWith("/search")) return t("search_results");

    return t(pathTitle[location.pathname]);
  }, [location.pathname, headerTitle, t]);

  const totalItems = historyItems.length + suggestions.length;

  const updateDropdownPosition = () => {
    if (searchContainerRef.current) {
      const rect = searchContainerRef.current.getBoundingClientRect();
      setDropdownPosition({
        x: rect.left,
        y: rect.bottom,
      });
    }
  };

  const focusInput = () => {
    setIsFocused(true);
    inputRef.current?.focus();
  };

  const handleFocus = () => {
    if (isFocused && isDropdownVisible) {
      updateDropdownPosition();
      return;
    }

    setIsFocused(true);
    setActiveIndex(-1);
    setTimeout(() => {
      updateDropdownPosition();
      setIsDropdownVisible(true);
    }, 220);
  };

  const handleBlur = () => {
    setTimeout(() => {
      setIsFocused(false);
      setIsDropdownVisible(false);
      setActiveIndex(-1);
    }, 200);
  };

  const handleBackButtonClick = () => {
    navigate(-1);
  };

  const handleSearch = useCallback(
    (value: string) => {
      if (isOnLibraryPage) {
        dispatch(setLibrarySearchQuery(value.slice(0, 255)));
      } else {
        dispatch(setFilters({ title: value.slice(0, 255) }));
      }
      setActiveIndex(-1);
    },
    [isOnLibraryPage, dispatch]
  );

  const executeSearch = useCallback(
    (query: string) => {
      const context = isOnLibraryPage ? "library" : "catalogue";
      if (query.trim()) {
        addToHistory(query, context);
      }
      handleSearch(query);

      if (!isOnLibraryPage && !location.pathname.startsWith("/catalogue")) {
        navigate("/catalogue");
      }

      setIsDropdownVisible(false);
      // In controller mode, keep focus on search input so user can navigate to results
      if (!isControllerMode) {
        inputRef.current?.blur();
      }
    },
    [
      addToHistory,
      handleSearch,
      isOnLibraryPage,
      isControllerMode,
      location.pathname,
      navigate,
    ]
  );

  const handleSelectHistory = useCallback(
    (query: string) => {
      executeSearch(query);
    },
    [executeSearch]
  );

  const handleSelectSuggestion = useCallback(
    (suggestion: { title: string; objectId: string; shop: GameShop }) => {
      setIsDropdownVisible(false);
      if (!isControllerMode) {
        inputRef.current?.blur();
      }
      navigate(buildGameDetailsPath(suggestion));
    },
    [isControllerMode, navigate]
  );

  // Handle gamepad navigation within the search dropdown
  useEffect(() => {
    if (!isControllerMode || !isDropdownVisible) return;

    const unsubscribe = subscribe((event) => {
      if (event.type !== "buttonpress") return;

      const { button } = event;
      const GamepadButton = {
        DPadUp: 12,
        DPadDown: 13,
        A: 0,
      };

      if (button === GamepadButton.DPadUp) {
        setActiveIndex((prev) => (prev > -1 ? prev - 1 : -1));
      } else if (button === GamepadButton.DPadDown) {
        setActiveIndex((prev) => (prev < totalItems - 1 ? prev + 1 : prev));
      } else if (button === GamepadButton.A) {
        if (activeIndex >= 0 && activeIndex < totalItems) {
          if (activeIndex < historyItems.length) {
            handleSelectHistory(historyItems[activeIndex].query);
          } else {
            const suggestionIndex = activeIndex - historyItems.length;
            handleSelectSuggestion(suggestions[suggestionIndex]);
          }
        }
      }
    });

    return unsubscribe;
  }, [
    isControllerMode,
    isDropdownVisible,
    activeIndex,
    totalItems,
    historyItems,
    suggestions,
    handleSelectHistory,
    handleSelectSuggestion,
    subscribe,
  ]);

  const handleClearSearch = () => {
    if (isOnLibraryPage) {
      dispatch(setLibrarySearchQuery(""));
    } else {
      dispatch(setFilters({ title: "" }));
    }
    setActiveIndex(-1);
  };

  const handleRemoveHistoryItem = (query: string) => {
    removeFromHistory(query);
  };

  const handleClearHistory = () => {
    clearHistory();
  };

  const handleKeyDown = (event: React.KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "Enter") {
      event.preventDefault();
      if (activeIndex >= 0 && activeIndex < totalItems) {
        if (activeIndex < historyItems.length) {
          handleSelectHistory(historyItems[activeIndex].query);
        } else {
          const suggestionIndex = activeIndex - historyItems.length;
          handleSelectSuggestion(suggestions[suggestionIndex]);
        }
      } else if (searchValue.trim()) {
        executeSearch(searchValue);
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

  const handleCloseDropdown = () => {
    setIsDropdownVisible(false);
    setActiveIndex(-1);
  };

  const handleStartScan = async () => {
    if (isScanning) return;

    setIsScanning(true);
    setScanResult(null);
    setShowScanModal(false);

    try {
      const result = await window.electron.scanInstalledGames();
      setScanResult(result);
    } finally {
      setIsScanning(false);
    }
  };

  const handleClearScanResult = () => {
    setScanResult(null);
  };

  useEffect(() => {
    if (!isDropdownVisible) return;

    const handleResize = () => {
      updateDropdownPosition();
    };

    window.addEventListener("resize", handleResize);
    return () => window.removeEventListener("resize", handleResize);
  }, [isDropdownVisible]);

  useEffect(() => {
    if (searchParams.get("openScanModal") === "true") {
      setShowScanModal(true);
      searchParams.delete("openScanModal");
      setSearchParams(searchParams, { replace: true });
    }
  }, [searchParams, setSearchParams]);

  return (
    <>
      <header
        className={cn("header", {
          "header--dragging-disabled": draggingDisabled,
          "header--is-windows": window.electron.platform === "win32",
        })}
      >
        <section className="header__section header__section--left">
          <button
            type="button"
            className={cn("header__back-button", {
              "header__back-button--enabled": location.key !== "default",
            })}
            onClick={handleBackButtonClick}
            disabled={location.key === "default"}
          >
            <ArrowLeftIcon />
          </button>

          <h3
            className={cn("header__title", {
              "header__title--has-back-button": location.key !== "default",
            })}
          >
            {title}
          </h3>
        </section>

        <section className="header__section">
          {isOnLibraryPage && window.electron.platform === "win32" && (
            <button
              type="button"
              className={cn("header__action-button", {
                "header__action-button--scanning": isScanning,
              })}
              onClick={() => setShowScanModal(true)}
              data-tooltip-id={scanButtonTooltipId}
              data-tooltip-content={t("scan_games_tooltip")}
              data-tooltip-place="bottom"
            >
              <SyncIcon size={16} />
            </button>
          )}

          <div
            ref={searchContainerRef}
            className={cn("header__search", {
              "header__search--focused": isFocused,
            })}
          >
            <button
              type="button"
              className="header__action-button"
              onClick={focusInput}
            >
              <SearchIcon />
            </button>

            <input
              ref={inputRef}
              type="text"
              name="search"
              placeholder={isOnLibraryPage ? t("search_library") : t("search")}
              value={searchValue}
              className="header__search-input"
              onChange={(event) => handleSearch(event.target.value)}
              onClick={handleInputClick}
              onFocus={handleFocus}
              onBlur={handleBlur}
              onKeyDown={handleKeyDown}
              readOnly={isControllerMode} // Prevent physical keyboard on mobile/controller mode if desired, or keep editable
            />

            {searchValue && (
              <button
                type="button"
                onClick={handleClearSearch}
                className="header__action-button"
              >
                <XIcon />
              </button>
            )}
          </div>
        </section>
      </header>

      {isOnLibraryPage && window.electron.platform === "win32" && (
        <Tooltip id={scanButtonTooltipId} style={{ zIndex: 1 }} />
      )}

      <AutoUpdateSubHeader />

      <SearchDropdown
        visible={
          isDropdownVisible &&
          (searchValue.trim().length > 0 ||
            historyItems.length > 0 ||
            suggestions.length > 0 ||
            isLoadingSuggestions)
        }
        position={dropdownPosition}
        historyItems={historyItems}
        suggestions={suggestions}
        isLoadingSuggestions={isLoadingSuggestions}
        onSelectHistory={handleSelectHistory}
        onSelectSuggestion={handleSelectSuggestion}
        onRemoveHistoryItem={handleRemoveHistoryItem}
        onClearHistory={handleClearHistory}
        onClose={handleCloseDropdown}
        activeIndex={activeIndex}
        currentQuery={searchValue}
        searchContainerRef={searchContainerRef}
      />

      <ScanGamesModal
        visible={showScanModal}
        onClose={() => setShowScanModal(false)}
        isScanning={isScanning}
        scanResult={scanResult}
        onStartScan={handleStartScan}
        onClearResult={handleClearScanResult}
      />

      <VirtualKeyboard
        visible={isVirtualKeyboardOpen}
        value={searchValue}
        onChange={(val) => handleSearch(val)}
        onClose={() => {
          setIsVirtualKeyboardOpen(false);
          inputRef.current?.focus();
        }}
        onEnter={() => {
          setIsVirtualKeyboardOpen(false);
          executeSearch(searchValue);
        }}
      />
    </>
  );
}
