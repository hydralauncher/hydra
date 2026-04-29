import type { LibraryGame } from "@types";
import { AnimatePresence, motion } from "framer-motion";
import { useEffect, useRef, useState } from "react";
import { IS_DESKTOP } from "../../constants";
import { useLibrary } from "../../hooks";
import {
  type LibraryViewMode,
  LibraryFocusGrid,
  LibraryFilters,
  LibraryFocusList,
  GameSettingsModal,
  LibraryHero,
  VerticalFocusGroup,
  LIBRARY_SECONDARY_FILTER_STORAGE_KEY,
  LIBRARY_SORT_BY_STORAGE_KEY,
  LIBRARY_VIEW_MODE_STORAGE_KEY,
  type LibrarySecondaryFilter,
  isLibraryViewMode,
  type LibraryFilterTab,
  type LibrarySortOption,
  isLibrarySecondaryFilter,
  isLibrarySortOption,
  useLibraryFavorite,
  useLibraryPageData,
} from "../../components";

import "./page.scss";

function getInitialLibraryViewMode(): LibraryViewMode {
  return getInitialLibraryStoredValue(
    LIBRARY_VIEW_MODE_STORAGE_KEY,
    isLibraryViewMode,
    "grid"
  );
}

function getInitialLibrarySortOption(): LibrarySortOption {
  return getInitialLibraryStoredValue(
    LIBRARY_SORT_BY_STORAGE_KEY,
    isLibrarySortOption,
    "last_played"
  );
}

function getInitialLibrarySecondaryFilter(): LibrarySecondaryFilter {
  return getInitialLibraryStoredValue(
    LIBRARY_SECONDARY_FILTER_STORAGE_KEY,
    isLibrarySecondaryFilter,
    "all_games"
  );
}

function getInitialLibraryStoredValue<TValue extends string>(
  storageKey: string,
  validator: (value: string | null | undefined) => value is TValue,
  fallbackValue: TValue
) {
  if (typeof globalThis.window === "undefined") {
    return fallbackValue;
  }

  try {
    const storedValue = globalThis.window.localStorage.getItem(storageKey);

    return validator(storedValue) ? storedValue : fallbackValue;
  } catch {
    return fallbackValue;
  }
}

export default function LibraryPage() {
  const hasMountedContentRef = useRef(false);
  const { library, updateLibrary } = useLibrary();
  const [selectedFilterTab, setSelectedFilterTab] =
    useState<LibraryFilterTab>("all");
  const [viewMode, setViewMode] = useState<LibraryViewMode>(
    getInitialLibraryViewMode
  );
  const [sortBy, setSortBy] = useState<LibrarySortOption>(
    getInitialLibrarySortOption
  );
  const [filterBy, setFilterBy] = useState<LibrarySecondaryFilter>(
    getInitialLibrarySecondaryFilter
  );
  const [search, setSearch] = useState("");
  const [settingsGame, setSettingsGame] = useState<LibraryGame | null>(null);
  const { favoriteLoadingGameId, toggleFavorite } =
    useLibraryFavorite(updateLibrary);
  const {
    filteredLibrary,
    filterCounts,
    firstGridItemId,
    firstListItemId,
    lastPlayedGames,
  } = useLibraryPageData(library, selectedFilterTab, search, sortBy, filterBy);
  const firstContentItemId =
    viewMode === "list" ? firstListItemId : firstGridItemId;
  const contentTransitionKey = `${selectedFilterTab}:${viewMode}`;
  const previousContentTransitionKeyRef = useRef(contentTransitionKey);
  const shouldAnimateContentChange =
    hasMountedContentRef.current &&
    previousContentTransitionKeyRef.current !== contentTransitionKey;

  useEffect(() => {
    updateLibrary();

    if (!IS_DESKTOP) return;

    const unsubscribe = globalThis.window.electron.onLibraryBatchComplete(
      () => {
        updateLibrary();
      }
    );

    return () => {
      unsubscribe();
    };
  }, [updateLibrary]);

  useEffect(() => {
    try {
      globalThis.window.localStorage.setItem(
        LIBRARY_VIEW_MODE_STORAGE_KEY,
        viewMode
      );
    } catch {
      // Ignore storage failures and keep the in-memory view mode.
    }
  }, [viewMode]);

  useEffect(() => {
    try {
      globalThis.window.localStorage.setItem(LIBRARY_SORT_BY_STORAGE_KEY, sortBy);
    } catch {
      // Ignore storage failures and keep the in-memory sort option.
    }
  }, [sortBy]);

  useEffect(() => {
    try {
      globalThis.window.localStorage.setItem(
        LIBRARY_SECONDARY_FILTER_STORAGE_KEY,
        filterBy
      );
    } catch {
      // Ignore storage failures and keep the in-memory filter option.
    }
  }, [filterBy]);

  useEffect(() => {
    hasMountedContentRef.current = true;
    previousContentTransitionKeyRef.current = contentTransitionKey;
  }, [contentTransitionKey]);

  if (library.length === 0 && lastPlayedGames.length === 0) {
    return (
      <div className="library-page__empty">
        <p>No games in library</p>
      </div>
    );
  }

  return (
    <section className="library-page">
      <VerticalFocusGroup>
        <LibraryHero
          lastPlayedGames={lastPlayedGames}
          onOpenGameSettings={(game) => {
            console.log("Library hero options clicked", game);
          }}
          onToggleFavorite={toggleFavorite}
          favoriteLoadingGameId={favoriteLoadingGameId}
        />

        <LibraryFilters
          selectedTab={selectedFilterTab}
          onSelectedTabChange={setSelectedFilterTab}
          viewMode={viewMode}
          onViewModeChange={setViewMode}
          sortBy={sortBy}
          onSortByChange={setSortBy}
          filterBy={filterBy}
          onFilterByChange={setFilterBy}
          search={search}
          onSearchChange={setSearch}
          counts={filterCounts}
          firstContentItemId={firstContentItemId}
        />

        <AnimatePresence mode="wait" initial={false}>
          <motion.div
            key={contentTransitionKey}
            layout={shouldAnimateContentChange}
            className="library-page__content-transition"
            initial={shouldAnimateContentChange ? { opacity: 0, y: 10 } : false}
            animate={{ opacity: 1, y: 0 }}
            exit={
              shouldAnimateContentChange ? { opacity: 0, y: -6 } : undefined
            }
            transition={
              shouldAnimateContentChange
                ? {
                    opacity: { duration: 0.18, ease: "easeOut" },
                    y: { duration: 0.18, ease: "easeOut" },
                    layout: { duration: 0.22, ease: "easeOut" },
                  }
                : undefined
            }
          >
            {viewMode === "list" ? (
              <LibraryFocusList games={filteredLibrary} />
            ) : (
              <LibraryFocusGrid games={filteredLibrary} />
            )}
          </motion.div>
        </AnimatePresence>
      </VerticalFocusGroup>

      <GameSettingsModal
        visible={settingsGame !== null}
        game={settingsGame}
        onClose={() => setSettingsGame(null)}
        onGameUpdated={(updatedGame) => {
          setSettingsGame(updatedGame);
          updateLibrary();
        }}
      />
    </section>
  );
}
