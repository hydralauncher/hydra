import type { LibraryGame } from "@types";
import { getGameCatalogueIdentity, getLibraryOperationalGame } from "@shared";
import { AnimatePresence, motion } from "framer-motion";
import {
  useCallback,
  useDeferredValue,
  useEffect,
  useLayoutEffect,
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
  useNavigationActions,
} from "../../hooks";
import {
  isBuiltinLibraryTab,
  getGameCollectionIds,
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
  LIBRARY_TAB_STORAGE_KEY,
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
  LIBRARY_FOCUS_GRID_REGION_ID,
  LIBRARY_FOCUS_LIST_REGION_ID,
  LIBRARY_HERO_LAUNCH_BUTTON_ID,
  LIBRARY_HERO_OPEN_SETTINGS_BUTTON_ID,
  LIBRARY_PAGE_REGION_ID,
} from "../../components/pages/library/navigation";
import {
  getLibraryViewState,
  saveLibraryScrollPosition,
  saveLibrarySearch,
} from "../../components/pages/library/library-view-state";

import "./page.scss";

interface GameContextMenuState {
  game: LibraryGame | null;
  visible: boolean;
  position: { x: number; y: number };
  restoreFocusId: string | null;
}

const DEFAULT_MENU_POSITION = { x: 0, y: 0 };

function isElementVisibleInScrollContainer(
  element: HTMLElement,
  container: HTMLElement
) {
  const elementRect = element.getBoundingClientRect();
  const containerRect = container.getBoundingClientRect();

  return (
    elementRect.bottom > containerRect.top &&
    elementRect.top < containerRect.bottom
  );
}

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

function getInitialLibraryFilterTab(): LibraryFilterTab {
  return getInitialLibraryStoredValue(
    LIBRARY_TAB_STORAGE_KEY,
    (value): value is LibraryFilterTab => Boolean(value),
    "all"
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
  const libraryScrollRef = useRef<HTMLElement | null>(null);
  const downloadModalRestoreFocusIdRef = useRef<string | null>(null);
  const settingsModalRestoreFocusIdRef = useRef<string | null>(null);
  const initialLibraryViewStateRef = useRef(getLibraryViewState());
  const hasRestoredLibraryViewRef = useRef(false);
  const isRestoringLibraryScrollRef = useRef(
    initialLibraryViewStateRef.current !== null
  );
  const isUnmountingLibraryRef = useRef(false);
  const navigate = useNavigate();
  const { setFocus } = useNavigationActions();
  const { showSuccessToast } = useBigPictureToast();
  const { library, updateLibrary } = useLibrary();
  const {
    collections,
    hasLoadedCollections,
    hasFailedToLoadCollections,
    loadCollections,
  } = useGameCollections();
  const [selectedFilterTab, setSelectedFilterTab] = useState<LibraryFilterTab>(
    getInitialLibraryFilterTab
  );
  const [viewMode, setViewMode] = useState<LibraryViewMode>(
    getInitialLibraryViewMode
  );
  const [sortBy, setSortBy] = useState<LibrarySortOption>(
    getInitialLibrarySortOption
  );
  const [filterBy, setFilterBy] = useState<LibrarySecondaryFilter>(
    getInitialLibrarySecondaryFilter
  );
  const [search, setSearch] = useState(
    () => initialLibraryViewStateRef.current?.search ?? ""
  );
  const [contextMenuState, setContextMenuState] =
    useState<GameContextMenuState>({
      game: null,
      visible: false,
      position: DEFAULT_MENU_POSITION,
      restoreFocusId: null,
    });
  const { favoriteLoadingGameId, toggleFavorite } =
    useLibraryFavorite(updateLibrary);
  const isSelectedFilterTabAvailable =
    isBuiltinLibraryTab(selectedFilterTab) ||
    collections.some((collection) => collection.id === selectedFilterTab);
  const activeFilterTab =
    isSelectedFilterTabAvailable || !hasFailedToLoadCollections
      ? selectedFilterTab
      : "all";
  const {
    groupedLibrary,
    filteredLibrary,
    filterCounts,
    firstGridItemId,
    firstListItemId,
    lastPlayedGames,
  } = useLibraryPageData(library, activeFilterTab, search, sortBy, filterBy);

  /** Must change when sorting, secondary filter or search updates so grid/list fades. */
  const deferredSearchTransition = useDeferredValue(search);

  const firstContentItemId =
    viewMode === "list" ? firstListItemId : firstGridItemId;
  const contentTransitionKey = `${activeFilterTab}:${viewMode}:${sortBy}:${filterBy}:${deferredSearchTransition}`;
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
    setSettingsModalGame(getLibraryOperationalGame(game));
    setIsGameSettingsModalOpen(true);
  }, []);

  const handleOpenGameSettingsFromContextMenu = useCallback(
    (game: LibraryGame) => {
      settingsModalRestoreFocusIdRef.current = contextMenuState.restoreFocusId;
      setSettingsModalGame(getLibraryOperationalGame(game));
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
      navigate(
        getBigPictureGameAchievementsPath({
          ...game,
          ...getGameCatalogueIdentity(game),
        })
      );
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
    sourceArchiveOption,
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

  useLayoutEffect(() => {
    isUnmountingLibraryRef.current = false;
    const scrollElement = libraryScrollRef.current;

    return () => {
      if (!isRestoringLibraryScrollRef.current && scrollElement) {
        saveLibraryScrollPosition(scrollElement.scrollTop);
      }

      isUnmountingLibraryRef.current = true;
    };
  }, []);

  useLayoutEffect(() => {
    if (hasRestoredLibraryViewRef.current) return;
    if (deferredSearchTransition !== search) return;

    if (filteredLibrary.length === 0) {
      if (library.length > 0) {
        hasRestoredLibraryViewRef.current = true;
        isRestoringLibraryScrollRef.current = false;
        setFocus(LIBRARY_FILTERS_SEARCH_INPUT_ID);
      }

      return;
    }

    const scrollElement = libraryScrollRef.current;
    if (!scrollElement) return;

    const savedState = initialLibraryViewStateRef.current;

    if (!savedState) {
      hasRestoredLibraryViewRef.current = true;
      isRestoringLibraryScrollRef.current = false;
      return;
    }

    let cancelled = false;
    let frameId: number | null = null;
    let restoreAttempts = 0;

    const focusTarget = (attempt: number) => {
      if (cancelled) return;

      const regionId =
        viewMode === "list"
          ? LIBRARY_FOCUS_LIST_REGION_ID
          : LIBRARY_FOCUS_GRID_REGION_ID;
      const region = globalThis.document.querySelector(
        `[data-focus-region-id="${regionId}"]`
      );
      const candidates =
        region instanceof HTMLElement
          ? Array.from(
              region.querySelectorAll<HTMLElement>("[data-focus-wrapper]")
            ).filter((element) =>
              isElementVisibleInScrollContainer(element, scrollElement)
            )
          : [];
      const savedElement = savedState.focusedItemId
        ? globalThis.document.getElementById(savedState.focusedItemId)
        : null;
      const target =
        savedElement instanceof HTMLElement && candidates.includes(savedElement)
          ? savedElement
          : candidates[0];

      if (target && setFocus(target.id)) return;

      if (attempt >= 10) {
        setFocus(LIBRARY_FILTERS_SEARCH_INPUT_ID);
        return;
      }

      frameId = globalThis.window.requestAnimationFrame(() =>
        focusTarget(attempt + 1)
      );
    };

    const applyScrollPosition = () => {
      if (cancelled) return;

      const maxScrollTop = Math.max(
        0,
        scrollElement.scrollHeight - scrollElement.clientHeight
      );

      if (maxScrollTop < savedState.scrollTop && restoreAttempts < 30) {
        restoreAttempts += 1;
        frameId = globalThis.window.requestAnimationFrame(applyScrollPosition);
        return;
      }

      scrollElement.scrollTop = Math.min(savedState.scrollTop, maxScrollTop);
      hasRestoredLibraryViewRef.current = true;
      isRestoringLibraryScrollRef.current = false;
      frameId = globalThis.window.requestAnimationFrame(() => focusTarget(0));
    };

    frameId = globalThis.window.requestAnimationFrame(applyScrollPosition);

    return () => {
      cancelled = true;

      if (frameId !== null) {
        globalThis.window.cancelAnimationFrame(frameId);
      }
    };
  }, [
    deferredSearchTransition,
    filteredLibrary.length,
    library.length,
    search,
    setFocus,
    viewMode,
  ]);

  useEffect(() => {
    if (filteredLibrary.length === 0) return;

    const scrollElement = libraryScrollRef.current;
    if (!scrollElement) return;

    let frameId: number | null = null;

    const saveScrollPosition = () => {
      if (
        isRestoringLibraryScrollRef.current ||
        isUnmountingLibraryRef.current
      ) {
        return;
      }

      saveLibraryScrollPosition(scrollElement.scrollTop);
    };

    const handleScroll = () => {
      if (frameId !== null) return;

      frameId = globalThis.window.requestAnimationFrame(() => {
        frameId = null;
        saveScrollPosition();
      });
    };

    scrollElement.addEventListener("scroll", handleScroll, {
      passive: true,
    });

    return () => {
      scrollElement.removeEventListener("scroll", handleScroll);

      if (frameId !== null) {
        globalThis.window.cancelAnimationFrame(frameId);
      }

      saveScrollPosition();
    };
  }, [filteredLibrary.length]);

  useEffect(() => {
    saveLibrarySearch(search);
  }, [search]);

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
    try {
      globalThis.window.localStorage.setItem(
        LIBRARY_TAB_STORAGE_KEY,
        selectedFilterTab
      );
    } catch {
      return;
    }
  }, [selectedFilterTab]);

  useEffect(() => {
    if (isSelectedFilterTabAvailable) return;

    if (hasLoadedCollections) {
      setSelectedFilterTab("all");
      return;
    }

    if (!hasFailedToLoadCollections || library.length === 0) return;

    const isCollectionInLibrary = library.some((game) =>
      getGameCollectionIds(game).includes(selectedFilterTab)
    );

    if (!isCollectionInLibrary) {
      setSelectedFilterTab("all");
    }
  }, [
    hasFailedToLoadCollections,
    hasLoadedCollections,
    isSelectedFilterTabAvailable,
    library,
    selectedFilterTab,
  ]);

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
      <section ref={libraryScrollRef} className="library-page">
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
      <section ref={libraryScrollRef} className="library-page">
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
            selectedTab={activeFilterTab}
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
            library={groupedLibrary}
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
                    scrollElementRef={libraryScrollRef}
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
                    scrollElementRef={libraryScrollRef}
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
          sourceArchiveOption={sourceArchiveOption}
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
