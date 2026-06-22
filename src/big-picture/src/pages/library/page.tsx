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
import { FolderOpen } from "@phosphor-icons/react";
import { IS_DESKTOP } from "../../constants";
import {
  buildLibraryToastOptions,
  getBigPictureGameAchievementsPath,
} from "../../helpers";
import {
  useBigPictureToast,
  useGameCollections,
  useLibrary,
  useNavigation,
} from "../../hooks";
import {
  isBuiltinLibraryTab,
  type LibraryViewMode,
  LibraryFocusGrid,
  LibraryFilters,
  LibraryFocusList,
  LibraryGameContextMenu,
  LibraryGameSettingsModal,
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
  useLibraryPendingAction,
  EmptyState,
} from "../../components";
import { ConfirmationModal, DownloadGameModal } from "../../components/modals";
import {
  LIBRARY_FILTERS_SEARCH_INPUT_ID,
  LIBRARY_HERO_LAUNCH_BUTTON_ID,
  LIBRARY_HERO_OPEN_SETTINGS_BUTTON_ID,
  LIBRARY_PAGE_REGION_ID,
} from "../../components/pages/library/navigation";

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
  const downloadModalRestoreFocusIdRef = useRef<string | null>(null);
  const settingsModalRestoreFocusIdRef = useRef<string | null>(null);
  const navigate = useNavigate();
  const { setFocus } = useNavigation();
  const { showSuccessToast } = useBigPictureToast();
  const { library, updateLibrary } = useLibrary();
  const { collections, loadCollections } = useGameCollections();
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

  const refreshLibraryData = useCallback(async () => {
    await Promise.all([updateLibrary(), loadCollections()]);
    globalThis.window.dispatchEvent(new Event("library-update"));
  }, [loadCollections, updateLibrary]);

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
  const [settingsModalGame, setSettingsModalGame] =
    useState<LibraryGame | null>(null);
  const [isGameSettingsModalOpen, setIsGameSettingsModalOpen] = useState(false);

  const openDownloadModal = useCallback(
    (game: LibraryGame, restoreFocusId: string | null) => {
      downloadModalRestoreFocusIdRef.current = restoreFocusId;

      globalThis.window.requestAnimationFrame(() => {
        setDownloadModalGame(game);
      });
    },
    []
  );

  const openDownloadModalFromContextMenu = useCallback(
    (game: LibraryGame) => {
      openDownloadModal(game, contextMenuState.restoreFocusId);
    },
    [contextMenuState.restoreFocusId, openDownloadModal]
  );

  const handleHeroPrimaryAction = useLibraryLaunchGame(
    useCallback(
      (game: LibraryGame) => {
        openDownloadModal(game, LIBRARY_HERO_LAUNCH_BUTTON_ID);
      },
      [openDownloadModal]
    )
  );

  const handleCloseDownloadModal = useCallback(() => {
    const restoreFocusId = downloadModalRestoreFocusIdRef.current;

    downloadModalRestoreFocusIdRef.current = null;
    setDownloadModalGame(null);

    if (!restoreFocusId) return;

    globalThis.window.requestAnimationFrame(() => {
      setFocus(restoreFocusId);
    });
  }, [setFocus]);

  const handleOpenHeroSettings = useCallback((game: LibraryGame) => {
    settingsModalRestoreFocusIdRef.current =
      LIBRARY_HERO_OPEN_SETTINGS_BUTTON_ID;
    setSettingsModalGame(game);
    setIsGameSettingsModalOpen(true);
  }, []);

  const handleOpenGameSettingsFromContextMenu = useCallback(
    (game: LibraryGame) => {
      settingsModalRestoreFocusIdRef.current = contextMenuState.restoreFocusId;
      setSettingsModalGame(game);
      setIsGameSettingsModalOpen(true);
    },
    [contextMenuState.restoreFocusId]
  );

  const handleCloseGameSettingsModal = useCallback(() => {
    const restoreFocusId = settingsModalRestoreFocusIdRef.current;

    settingsModalRestoreFocusIdRef.current = null;
    setIsGameSettingsModalOpen(false);
    setSettingsModalGame(null);

    if (!restoreFocusId) return;

    globalThis.window.requestAnimationFrame(() => {
      setFocus(restoreFocusId);
    });
  }, [setFocus]);

  const handleLaunchOrDownload = useLibraryLaunchGame(
    useCallback(
      (game: LibraryGame) => {
        openDownloadModalFromContextMenu(game);
      },
      [openDownloadModalFromContextMenu]
    )
  );

  const handleViewAchievements = useCallback(
    (game: LibraryGame) => {
      navigate(getBigPictureGameAchievementsPath(game));
    },
    [navigate]
  );

  const {
    pendingAction,
    isSubmittingAction,
    requestRemoveFiles,
    requestRemoveFromLibrary,
    closePendingAction,
    confirmPendingAction,
  } = useLibraryPendingAction({
    getRestoreFocusId: useCallback(
      () => contextMenuState.restoreFocusId,
      [contextMenuState.restoreFocusId]
    ),
    onDataRefresh: refreshLibraryData,
    setFocus,
    showSuccessToast,
    buildToastOptions: buildLibraryToastOptions,
    fallbackFocusId: LIBRARY_FILTERS_SEARCH_INPUT_ID,
  });

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
      <section className="library-page">
        <VerticalFocusGroup regionId={LIBRARY_PAGE_REGION_ID}>
          <div className="library-page__empty">
            <p>No games in library</p>
          </div>
        </VerticalFocusGroup>
      </section>
    );
  }

  return (
    <>
      <section className="library-page">
        <VerticalFocusGroup
          regionId={LIBRARY_PAGE_REGION_ID}
          style={{ flex: 1 }}
        >
          <LibraryHero
            onPrimaryAction={handleHeroPrimaryAction}
            onOpenSettings={handleOpenHeroSettings}
            favoriteLoadingGameId={favoriteLoadingGameId}
            lastPlayedGames={lastPlayedGames}
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

          {filteredLibrary.length === 0 ? (
            <EmptyState
              className="library-page__empty-state"
              icon={<FolderOpen size={28} weight="bold" />}
              title={search ? "No results found" : "Empty collection"}
              description={
                search
                  ? "Try adjusting your search terms or filters."
                  : "Add games to this collection to see them here."
              }
            />
          ) : (
            <AnimatePresence mode="wait" initial={false}>
              <motion.div
                key={contentTransitionKey}
                layout={shouldAnimateContentChange}
                className="library-page__content-transition"
                initial={
                  shouldAnimateContentChange ? { opacity: 0, y: 10 } : false
                }
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
          )}
        </VerticalFocusGroup>
      </section>

      <LibraryGameContextMenu
        game={contextMenuState.game}
        visible={contextMenuState.visible}
        position={contextMenuState.position}
        restoreFocusId={contextMenuState.restoreFocusId}
        isFavoriteLoading={favoriteLoadingGameId === contextMenuState.game?.id}
        onClose={handleCloseGameContextMenu}
        onLaunchOrDownload={handleLaunchOrDownload}
        onToggleFavorite={toggleFavorite}
        onViewAchievements={handleViewAchievements}
        onOptions={handleOpenGameSettingsFromContextMenu}
        onUninstall={requestRemoveFiles}
        onRemoveFromLibrary={requestRemoveFromLibrary}
      />

      {pendingAction ? (
        <ConfirmationModal
          visible
          title={
            pendingAction.type === "remove-files"
              ? "Remove downloaded files?"
              : "Remove from library?"
          }
          description={
            pendingAction.type === "remove-files"
              ? "This deletes the downloaded game files from disk."
              : `Remove ${pendingAction.game.title} from your library. Downloaded files will not be deleted.`
          }
          confirmLabel={
            pendingAction.type === "remove-files" ? "Remove files" : "Remove"
          }
          danger
          loading={isSubmittingAction}
          onClose={closePendingAction}
          onConfirm={confirmPendingAction}
        />
      ) : null}

      {downloadModalGame ? (
        <DownloadGameModal
          key={downloadModalGame.id}
          visible
          onClose={handleCloseDownloadModal}
          game={downloadModalGame}
        />
      ) : null}

      {settingsModalGame ? (
        <LibraryGameSettingsModal
          visible={isGameSettingsModalOpen}
          game={settingsModalGame}
          onClose={handleCloseGameSettingsModal}
        />
      ) : null}
    </>
  );
}
