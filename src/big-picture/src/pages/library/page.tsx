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
import { ConfirmationModal, DownloadGameModal } from "../../components/modals";
import {
  LIBRARY_FILTERS_SEARCH_INPUT_ID,
  LIBRARY_PAGE_REGION_ID,
} from "../../components/pages/library/navigation";
import { logger } from "@renderer/logger";

import "./page.scss";

interface GameContextMenuState {
  game: LibraryGame | null;
  visible: boolean;
  position: { x: number; y: number };
  restoreFocusId: string | null;
}

interface PendingLibraryAction {
  type: "remove-files" | "remove-from-library";
  game: LibraryGame;
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
  const [pendingAction, setPendingAction] =
    useState<PendingLibraryAction | null>(null);
  const [isSubmittingAction, setIsSubmittingAction] = useState(false);
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

  const openDownloadModalFromContextMenu = useCallback(
    (game: LibraryGame) => {
      const restoreFocusId = contextMenuState.restoreFocusId;
      downloadModalRestoreFocusIdRef.current = restoreFocusId;

      globalThis.window.requestAnimationFrame(() => {
        setDownloadModalGame(game);
      });
    },
    [contextMenuState.restoreFocusId]
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

  const handleRequestRemoveFiles = useCallback(
    (game: LibraryGame) => {
      setPendingAction({
        type: "remove-files",
        game,
        restoreFocusId: contextMenuState.restoreFocusId,
      });
    },
    [contextMenuState.restoreFocusId]
  );

  const handleRequestRemoveFromLibrary = useCallback(
    (game: LibraryGame) => {
      setPendingAction({
        type: "remove-from-library",
        game,
        restoreFocusId: contextMenuState.restoreFocusId,
      });
    },
    [contextMenuState.restoreFocusId]
  );

  const handleClosePendingAction = useCallback(() => {
    const restoreFocusId = pendingAction?.restoreFocusId ?? null;

    setPendingAction(null);
    setIsSubmittingAction(false);

    if (!restoreFocusId) return;

    globalThis.window.requestAnimationFrame(() => {
      setFocus(restoreFocusId);
    });
  }, [pendingAction?.restoreFocusId, setFocus]);

  const handleConfirmPendingAction = useCallback(async () => {
    const currentAction = pendingAction;

    if (!currentAction || !IS_DESKTOP) return;

    setIsSubmittingAction(true);

    try {
      const { game } = currentAction;

      if (
        game.download?.status === "active" ||
        game.download?.status === "extracting" ||
        game.download?.extracting
      ) {
        await globalThis.window.electron.cancelGameDownload(
          game.shop,
          game.objectId
        );
      } else if (currentAction.type === "remove-files") {
        if (game.download?.status === "seeding") {
          await globalThis.window.electron.pauseGameSeed(
            game.shop,
            game.objectId
          );
        }
      }

      if (currentAction.type === "remove-files") {
        await globalThis.window.electron.deleteGameFolder(
          game.shop,
          game.objectId
        );
      } else {
        await globalThis.window.electron.removeGameFromLibrary(
          game.shop,
          game.objectId
        );
      }

      await refreshLibraryData();

      if (currentAction.type === "remove-from-library") {
        const { title, ...toastOptions } = await buildLibraryToastOptions(
          game,
          "removed"
        );
        showSuccessToast(title, toastOptions);
      }

      setPendingAction(null);
      setIsSubmittingAction(false);

      globalThis.window.requestAnimationFrame(() => {
        setFocus(
          currentAction.type === "remove-from-library"
            ? LIBRARY_FILTERS_SEARCH_INPUT_ID
            : (currentAction.restoreFocusId ?? LIBRARY_FILTERS_SEARCH_INPUT_ID)
        );
      });
    } catch (error) {
      logger.error("Failed to execute library action", error);
      setIsSubmittingAction(false);
    }
  }, [pendingAction, refreshLibraryData, setFocus, showSuccessToast]);

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
        <VerticalFocusGroup regionId={LIBRARY_PAGE_REGION_ID}>
          <LibraryHero
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
        onUninstall={handleRequestRemoveFiles}
        onRemoveFromLibrary={handleRequestRemoveFromLibrary}
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
          onClose={handleClosePendingAction}
          onConfirm={handleConfirmPendingAction}
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
    </>
  );
}
