import type { LibraryGame } from "@types";
import { AnimatePresence, motion } from "framer-motion";
import {
  useCallback,
  useDeferredValue,
  useEffect,
  useRef,
  useState,
} from "react";
import { useNavigate } from "react-router-dom";
import { IS_DESKTOP } from "../../constants";
import { useGameCollections, useLibrary } from "../../hooks";
import {
  isBuiltinLibraryTab,
  type LibraryViewMode,
  LibraryFocusGrid,
  LibraryFilters,
  LibraryFocusList,
  LibraryGameContextMenu,
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
  useLibraryLaunchGame,
  useLibraryPageData,
} from "../../components";
import { DownloadGameModal } from "../../components/modals";
import { logger } from "@renderer/logger";

import { getBigPictureGameDetailsPath } from "../../helpers";

import "./page.scss";

interface GameContextMenuState {
  game: LibraryGame | null;
  visible: boolean;
  position: { x: number; y: number };
  restoreFocusId: string | null;
}

const DEFAULT_MENU_POSITION = { x: 0, y: 0 };

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
  if (globalThis.window === undefined) {
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
  const navigate = useNavigate();
  const { library, updateLibrary } = useLibrary();
  const { collections } = useGameCollections();
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
  const [contextMenuState, setContextMenuState] =
    useState<GameContextMenuState>({
      game: null,
      visible: false,
      position: DEFAULT_MENU_POSITION,
      restoreFocusId: null,
    });
  const { favoriteLoadingGameId, toggleFavorite } =
    useLibraryFavorite(updateLibrary);
  const {
    filteredLibrary,
    filterCounts,
    firstGridItemId,
    firstListItemId,
    lastPlayedGames,
  } = useLibraryPageData(library, selectedFilterTab, search, sortBy, filterBy);

  /** Must change when sorting, secondary filter or search updates so grid/list fades. */
  const deferredSearchTransition = useDeferredValue(search);

  const firstContentItemId =
    viewMode === "list" ? firstListItemId : firstGridItemId;
  const contentTransitionKey = `${selectedFilterTab}:${viewMode}:${sortBy}:${filterBy}:${deferredSearchTransition}`;
  const previousContentTransitionKeyRef = useRef(contentTransitionKey);
  const shouldAnimateContentChange =
    hasMountedContentRef.current &&
    previousContentTransitionKeyRef.current !== contentTransitionKey;

  const handleOpenGameContextMenu = useCallback(
    (
      game: LibraryGame,
      position: { x: number; y: number },
      restoreFocusId: string
    ) => {
      setContextMenuState({
        game,
        visible: true,
        position,
        restoreFocusId,
      });
    },
    []
  );

  const handleCloseGameContextMenu = useCallback(() => {
    setContextMenuState((currentState) => ({
      ...currentState,
      visible: false,
    }));
  }, []);

  const [downloadModalGame, setDownloadModalGame] =
    useState<LibraryGame | null>(null);

  const handleCloseDownloadModal = useCallback(() => {
    setDownloadModalGame(null);
  }, []);

  const handleLaunchOrDownload = useLibraryLaunchGame(
    useCallback((game: LibraryGame) => {
      setDownloadModalGame(game);
    }, [])
  );

  const handleOpenGamePage = useCallback(
    (game: LibraryGame) => {
      navigate(getBigPictureGameDetailsPath(game));
    },
    [navigate]
  );

  const logOptionsPlaceholder = useCallback(
    (game: LibraryGame, source: "library-hero" | "library-context-menu") => {
      console.log("big-picture options placeholder", {
        source,
        id: game.id,
        objectId: game.objectId,
        title: game.title,
      });
    },
    []
  );

  const handleRequestRemoveFiles = useCallback((game: LibraryGame) => {
    console.log("big-picture library uninstall placeholder", {
      source: "library-context-menu",
      id: game.id,
      objectId: game.objectId,
      title: game.title,
    });
  }, []);

  const handleRequestRemoveFromLibrary = useCallback((game: LibraryGame) => {
    console.log("big-picture library remove-from-library placeholder", {
      source: "library-context-menu",
      id: game.id,
      objectId: game.objectId,
      title: game.title,
    });
  }, []);

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
      globalThis.window.localStorage.setItem(
        LIBRARY_SORT_BY_STORAGE_KEY,
        sortBy
      );
    } catch {
      // Ignore storage failures and keep the in-memory sort option.
    }
  }, [sortBy]);

  useEffect(() => {
    if (
      isBuiltinLibraryTab(selectedFilterTab) ||
      collections.some((c) => c.id === selectedFilterTab)
    ) {
      return;
    }

    setSelectedFilterTab("all");
  }, [collections, selectedFilterTab]);

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
          favoriteLoadingGameId={favoriteLoadingGameId}
          lastPlayedGames={lastPlayedGames}
          onOpenOptions={(game) => {
            logOptionsPlaceholder(game, "library-hero");
          }}
          onToggleFavorite={toggleFavorite}
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
          library={library}
          collections={collections}
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
              <LibraryFocusList
                games={filteredLibrary}
                contextMenuGameId={
                  contextMenuState.visible
                    ? (contextMenuState.game?.id ?? null)
                    : null
                }
                onOpenContextMenu={handleOpenGameContextMenu}
              />
            ) : (
              <LibraryFocusGrid
                games={filteredLibrary}
                contextMenuGameId={
                  contextMenuState.visible
                    ? (contextMenuState.game?.id ?? null)
                    : null
                }
                onOpenContextMenu={handleOpenGameContextMenu}
              />
            )}
          </motion.div>
        </AnimatePresence>
      </VerticalFocusGroup>

      <LibraryGameContextMenu
        game={contextMenuState.game}
        visible={contextMenuState.visible}
        position={contextMenuState.position}
        restoreFocusId={contextMenuState.restoreFocusId}
        isFavoriteLoading={favoriteLoadingGameId === contextMenuState.game?.id}
        onClose={handleCloseGameContextMenu}
        onLaunchOrDownload={handleLaunchOrDownload}
        onOpenGamePage={handleOpenGamePage}
        onToggleFavorite={toggleFavorite}
        onViewAchievements={(game) => {
          logger.log("library-context-menu achievements", {
            objectId: game.objectId,
          });
        }}
        onShare={(game) => {
          logger.log("library-context-menu share", { objectId: game.objectId });
        }}
        onOptions={(game) => {
          logOptionsPlaceholder(game, "library-context-menu");
        }}
        onUninstall={handleRequestRemoveFiles}
        onRemoveFromLibrary={handleRequestRemoveFromLibrary}
      />

      {downloadModalGame ? (
        <DownloadGameModal
          key={downloadModalGame.id}
          visible
          onClose={handleCloseDownloadModal}
          game={downloadModalGame}
        />
      ) : null}
    </section>
  );
}
