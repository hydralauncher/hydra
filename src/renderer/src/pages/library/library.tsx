import {
  useDeferredValue,
  useEffect,
  useLayoutEffect,
  useMemo,
  useState,
  useCallback,
  useRef,
} from "react";
import {
  useLibrary,
  useAppDispatch,
  useAppSelector,
  useGameCollections,
  useUserDetails,
} from "@renderer/hooks";
import { selectIsLibraryLoading, setHeaderTitle } from "@renderer/features";
import {
  HeartIcon,
  TelescopeIcon,
  FileDirectoryIcon,
  SearchIcon,
  SyncIcon,
} from "@primer/octicons-react";
import { useTranslation } from "react-i18next";
import { AuthPage, groupLibraryGames, removeDiacritics } from "@shared";
import { GameCollection, LibraryGame } from "@types";
import { CreateCollectionModal, GameContextMenu } from "@renderer/components";
import { useCollectionContextMenu } from "@renderer/context";
import {
  getGameCollectionIds,
  isGameInstalled,
  sortLibraryGames,
  sortLibraryGamesIncrementally,
  type LibrarySortCache,
} from "@renderer/helpers";
import { useSearchParams } from "react-router-dom";
import { LibraryGamesGrid } from "./library-games-grid";
import { LibraryScrollbar } from "./library-scrollbar";
import { ViewOptions, ViewMode } from "./view-options";
import { FilterOptions, SortOption } from "./filter-options";
import { CategoryFilter, LibraryCategory } from "./category-filter";
import { InstalledFilter } from "./installed-filter";
import { PlatformFilter } from "./platform-filter";
import { SourceFilter } from "./source-filter";
import { CollectionsFilter } from "./collections-filter";
import { LibraryGamesSkeleton } from "./library-games-skeleton";
import {
  categoryShowsPlatforms,
  categoryShowsSources,
  filterLibraryGames,
  getLibraryFilterOptions,
  readStoredLibraryFilters,
  type LibrarySource,
} from "./library-category";
import {
  LIBRARY_INSTALLED_ONLY_STORAGE_KEY,
  LIBRARY_PLATFORMS_STORAGE_KEY,
  LIBRARY_SOURCES_STORAGE_KEY,
} from "@renderer/session-state";
import {
  ClassicsOnboardingModal,
  hasDismissedClassicsOnboarding,
} from "@renderer/components/classics-onboarding-modal/classics-onboarding-modal";
import "./library.scss";

const FAVORITES_COLLECTION_ID = "__favorites__";
const HIDDEN_COLLECTION_ID = "__hidden__";
const EMPTY_HIDDEN_GAMES: LibraryGame[] = [];
const GAP = 16;
const LARGE_GAP = 20;
const LARGE_CARD_ESTIMATED_HEIGHT = 300;
const FALLBACK_ITEM_WIDTH = 150;
const COLUMN_BREAKPOINTS = [3000, 2600, 2000, 1300, 900] as const;
const COLUMNS: Record<"grid" | "compact", readonly number[]> = {
  grid: [12, 8, 6, 5, 4, 2],
  compact: [14, 12, 9, 7, 5, 3],
};

const getColumnsCount = (width: number, mode: ViewMode): number => {
  if (mode === "large") return width >= 900 ? 2 : 1;
  const idx = COLUMN_BREAKPOINTS.findIndex((bp) => width >= bp);
  return COLUMNS[mode][idx === -1 ? COLUMN_BREAKPOINTS.length : idx];
};

const SCROLL_RESTORE_WINDOW_MS = 1000;

let savedLibraryScroll: {
  viewKey: string;
  top: number;
  headerHidden: boolean;
} | null = null;

const readStoredPlatforms = (): string[] => {
  try {
    const saved = localStorage.getItem(LIBRARY_PLATFORMS_STORAGE_KEY);
    if (!saved) return [];

    const parsed = JSON.parse(saved);
    if (!Array.isArray(parsed)) return [];

    return parsed.filter((item): item is string => typeof item === "string");
  } catch {
    return [];
  }
};

const SORT_OPTIONS: SortOption[] = [
  "title_asc",
  "recently_played",
  "most_played",
  "achievements",
  "installed_first",
];

export default function Library() {
  const { library, updateLibrary } = useLibrary();
  const { userDetails } = useUserDetails();
  const accountId = userDetails?.id ?? null;
  const activeAccountIdRef = useRef(accountId);
  activeAccountIdRef.current = accountId;
  const [hiddenGamesState, setHiddenGamesState] = useState<{
    ownerId: string | null;
    games: LibraryGame[];
  }>({ ownerId: null, games: [] });
  const hiddenGames =
    accountId && hiddenGamesState.ownerId === accountId
      ? hiddenGamesState.games
      : EMPTY_HIDDEN_GAMES;
  const [hiddenGamesLoadFailed, setHiddenGamesLoadFailed] = useState(false);
  const [hiddenGamesLoading, setHiddenGamesLoading] = useState(true);
  const updateHiddenGames = useCallback(async () => {
    if (!accountId) {
      setHiddenGamesState({ ownerId: null, games: [] });
      setHiddenGamesLoading(false);
      return;
    }
    try {
      const games = await window.electron.getHiddenLibrary();
      if (activeAccountIdRef.current === accountId) {
        setHiddenGamesState({ ownerId: accountId, games });
        setHiddenGamesLoadFailed(false);
      }
    } catch {
      if (activeAccountIdRef.current === accountId) {
        setHiddenGamesLoadFailed(true);
      }
    } finally {
      if (activeAccountIdRef.current === accountId) {
        setHiddenGamesLoading(false);
      }
    }
  }, [accountId]);

  const retryHiddenGames = useCallback(async () => {
    setHiddenGamesLoading(true);
    await window.electron.refreshLibraryAssets().catch(() => {});
    if (activeAccountIdRef.current === accountId) {
      await Promise.allSettled([updateLibrary(), updateHiddenGames()]);
    }
  }, [accountId, updateLibrary, updateHiddenGames]);
  useEffect(() => {
    if (accountId) {
      void updateHiddenGames();
    } else {
      setHiddenGamesState({ ownerId: null, games: [] });
      setHiddenGamesLoadFailed(false);
    }
  }, [accountId, updateHiddenGames]);
  const {
    collections,
    loadCollections,
    hasLoaded: hasLoadedCollections,
    hasFailed: hasFailedToLoadCollections,
  } = useGameCollections();
  const [searchParams, setSearchParams] = useSearchParams();
  const { openCollectionContextMenu } = useCollectionContextMenu();

  const [viewMode, setViewMode] = useState<ViewMode>(() => {
    const savedViewMode = localStorage.getItem("library-view-mode");
    return (savedViewMode as ViewMode) || "compact";
  });
  const [sortBy, setSortBy] = useState<SortOption>(() => {
    const savedSortBy = localStorage.getItem("library-sort-by");
    if (savedSortBy && SORT_OPTIONS.includes(savedSortBy as SortOption)) {
      return savedSortBy as SortOption;
    }

    return "title_asc";
  });
  const [gameContextMenu, setGameContextMenu] = useState<{
    game: LibraryGame | null;
    visible: boolean;
    position: { x: number; y: number };
  }>({ game: null, visible: false, position: { x: 0, y: 0 } });
  const [showCreateCollectionModal, setShowCreateCollectionModal] =
    useState(false);

  const [storedFilters] = useState(() =>
    readStoredLibraryFilters(
      localStorage,
      "library-category",
      LIBRARY_SOURCES_STORAGE_KEY
    )
  );
  const [category, setCategory] = useState<LibraryCategory>(
    storedFilters.category
  );
  const [selectedSources, setSelectedSources] = useState<LibrarySource[]>(
    storedFilters.sources
  );
  const [selectedPlatforms, setSelectedPlatforms] =
    useState<string[]>(readStoredPlatforms);
  const [showInstalledOnly, setShowInstalledOnly] = useState<boolean>(
    () => localStorage.getItem(LIBRARY_INSTALLED_ONLY_STORAGE_KEY) === "true"
  );
  const [isImportingClassics, setIsImportingClassics] = useState(false);

  const effectiveCategory: LibraryCategory = category;

  const [showClassicsOnboarding, setShowClassicsOnboarding] = useState(false);
  const classicsOnboardingTriggeredRef = useRef(false);

  const gamesScrollRef = useRef<HTMLDivElement>(null);
  const [isScrollbarDragging, setIsScrollbarDragging] = useState(false);
  const [containerWidth, setContainerWidth] = useState(0);
  const [isGamesScrolled, setIsGamesScrolled] = useState(false);
  const [isHeaderHidden, setIsHeaderHidden] = useState(
    () => savedLibraryScroll?.headerHidden ?? false
  );
  const isHeaderHiddenRef = useRef(isHeaderHidden);

  const libraryViewKeyRef = useRef("");
  const scrollRestoreDoneRef = useRef(false);

  const getInitialScrollOffset = useCallback(() => {
    const saved = savedLibraryScroll;
    if (
      scrollRestoreDoneRef.current ||
      !saved ||
      saved.viewKey !== libraryViewKeyRef.current
    ) {
      return 0;
    }
    return saved.top;
  }, []);

  const setHeaderHidden = useCallback((next: boolean) => {
    isHeaderHiddenRef.current = next;
    setIsHeaderHidden(next);
    if (savedLibraryScroll) {
      savedLibraryScroll = { ...savedLibraryScroll, headerHidden: next };
    }
  }, []);

  const handleGamesScroll = useCallback(
    (event: React.UIEvent<HTMLDivElement>) => {
      const { scrollTop } = event.currentTarget;
      setIsGamesScrolled(scrollTop > 0);
      if (!scrollRestoreDoneRef.current) return;
      savedLibraryScroll = {
        viewKey: libraryViewKeyRef.current,
        top: scrollTop,
        headerHidden: isHeaderHiddenRef.current,
      };
    },
    []
  );

  useEffect(() => {
    const timer = window.setTimeout(() => {
      if (scrollRestoreDoneRef.current) return;
      scrollRestoreDoneRef.current = true;
      setHeaderHidden(false);
    }, SCROLL_RESTORE_WINDOW_MS);
    return () => window.clearTimeout(timer);
  }, [setHeaderHidden]);

  useEffect(() => {
    const el = gamesScrollRef.current;
    if (!el) return;

    const handleWheel = (event: WheelEvent) => {
      if (event.deltaY > 0) {
        if (!isHeaderHiddenRef.current) {
          event.preventDefault();
          el.scrollTo({ top: el.scrollTop, behavior: "auto" });
          setHeaderHidden(true);
        }
      } else if (event.deltaY < 0 && isHeaderHiddenRef.current) {
        event.preventDefault();
        el.scrollTo({ top: el.scrollTop, behavior: "auto" });
        setHeaderHidden(false);
      }
    };

    el.addEventListener("wheel", handleWheel, { passive: false });
    return () => el.removeEventListener("wheel", handleWheel);
  }, [setHeaderHidden]);

  useLayoutEffect(() => {
    const el = gamesScrollRef.current;
    if (!el) return;

    const measure = () => {
      const style = window.getComputedStyle(el);
      setContainerWidth(
        el.getBoundingClientRect().width -
          (el.offsetWidth - el.clientWidth) -
          (Number.parseFloat(style.paddingLeft) || 0) -
          (Number.parseFloat(style.paddingRight) || 0)
      );
    };

    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  useEffect(() => {
    if (
      effectiveCategory === "classics" &&
      !classicsOnboardingTriggeredRef.current &&
      !hasDismissedClassicsOnboarding()
    ) {
      classicsOnboardingTriggeredRef.current = true;
      setShowClassicsOnboarding(true);
    }
  }, [effectiveCategory]);

  const handlePlatformsChange = useCallback((next: string[]) => {
    setSelectedPlatforms(next);
    localStorage.setItem(LIBRARY_PLATFORMS_STORAGE_KEY, JSON.stringify(next));
  }, []);

  const handleSourcesChange = useCallback((next: LibrarySource[]) => {
    setSelectedSources(next);
    localStorage.setItem(LIBRARY_SOURCES_STORAGE_KEY, JSON.stringify(next));
  }, []);

  const handleShowInstalledOnlyChange = useCallback((next: boolean) => {
    setShowInstalledOnly(next);
    localStorage.setItem(LIBRARY_INSTALLED_ONLY_STORAGE_KEY, String(next));
  }, []);

  const handleCategoryChange = useCallback(
    (next: LibraryCategory) => {
      setCategory(next);
      localStorage.setItem("library-category", next);
      if (!categoryShowsPlatforms(next)) {
        handlePlatformsChange([]);
      }
      if (!categoryShowsSources(next)) {
        handleSourcesChange([]);
      }
    },
    [handlePlatformsChange, handleSourcesChange]
  );

  const searchQuery = useAppSelector((state) => state.library.searchQuery);
  const isLibraryLoading = useAppSelector(selectIsLibraryLoading);
  const runningGameId = useAppSelector(
    (state) => state.gameRunning.gameRunning?.id
  );
  const deferredSearchQuery = useDeferredValue(searchQuery);
  const dispatch = useAppDispatch();
  const { t } = useTranslation(["library", "sidebar"]);

  const selectedCollectionId = searchParams.get("collection");

  const handleCollectionSelect = useCallback(
    (collectionId: string | null) => {
      const params = new URLSearchParams(searchParams);

      if (collectionId) {
        params.set("collection", collectionId);
        localStorage.setItem("library-collection", collectionId);
      } else {
        params.delete("collection");
        localStorage.removeItem("library-collection");
      }

      setSearchParams(params, { replace: true });
    },
    [searchParams, setSearchParams]
  );

  const hasRestoredCollection = useRef(false);

  useLayoutEffect(() => {
    if (hasRestoredCollection.current) return;
    hasRestoredCollection.current = true;

    if (searchParams.get("collection")) return;

    const savedCollectionId = localStorage.getItem("library-collection");
    if (!savedCollectionId) return;

    const params = new URLSearchParams(searchParams);
    params.set("collection", savedCollectionId);
    setSearchParams(params, { replace: true });
  }, [searchParams, setSearchParams]);

  const handleViewModeChange = useCallback((mode: ViewMode) => {
    setViewMode(mode);
    localStorage.setItem("library-view-mode", mode);
  }, []);

  const handleSortChange = useCallback((nextSortBy: SortOption) => {
    setSortBy(nextSortBy);
    localStorage.setItem("library-sort-by", nextSortBy);
  }, []);

  useEffect(() => {
    dispatch(setHeaderTitle(t("library")));

    const unsubscribe = window.electron.onLibraryBatchComplete(() => {
      updateLibrary();
      void updateHiddenGames();
      void loadCollections();
    });

    const unsubscribeClassicsImport = window.electron.onClassicsImportStatus(
      (importing) => setIsImportingClassics(importing)
    );

    void window.electron
      .getClassicsImportStatus()
      .then((importing) => setIsImportingClassics(importing));

    window.electron
      .refreshLibraryAssets()
      .catch(() => {})
      .finally(() => {
        const collectionsPromise = hasLoadedCollections
          ? Promise.resolve([])
          : loadCollections();

        void Promise.all([
          updateLibrary(),
          updateHiddenGames(),
          collectionsPromise,
        ]);
      });

    return () => {
      unsubscribe();
      unsubscribeClassicsImport();
    };
  }, [
    dispatch,
    t,
    updateLibrary,
    updateHiddenGames,
    loadCollections,
    hasLoadedCollections,
  ]);

  useEffect(() => {
    const refresh = () => {
      void Promise.all([
        updateLibrary(),
        updateHiddenGames(),
        loadCollections(),
      ]);
    };
    window.addEventListener("hydra:game-visibility-updated", refresh);
    return () =>
      window.removeEventListener("hydra:game-visibility-updated", refresh);
  }, [updateLibrary, updateHiddenGames, loadCollections]);

  const handleOpenContextMenu = useCallback(
    (game: LibraryGame, position: { x: number; y: number }) => {
      setGameContextMenu({ game, visible: true, position });
    },
    []
  );

  const handleCloseContextMenu = useCallback(() => {
    setGameContextMenu((prev) => ({ ...prev, visible: false }));
  }, []);

  useEffect(() => {
    const handlePinToggled = () => {
      void updateLibrary();
    };

    window.addEventListener("hydra:game-pin-toggled", handlePinToggled);
    return () => {
      window.removeEventListener("hydra:game-pin-toggled", handlePinToggled);
    };
  }, [updateLibrary]);

  const handleCreateCollectionButtonClick = useCallback(() => {
    if (!userDetails) {
      window.electron.openAuthWindow(AuthPage.SignIn);
      return;
    }

    setShowCreateCollectionModal(true);
  }, [userDetails]);

  useEffect(() => {
    if (!selectedCollectionId) return;
    if (selectedCollectionId === FAVORITES_COLLECTION_ID) return;
    if (selectedCollectionId === HIDDEN_COLLECTION_ID) {
      if (!userDetails) handleCollectionSelect(null);
      return;
    }

    if (hasLoadedCollections) {
      const hasCollection = collections.some(
        (collection) => collection.id === selectedCollectionId
      );

      if (!hasCollection) {
        handleCollectionSelect(null);
      }
      return;
    }

    if (!hasFailedToLoadCollections || library.length === 0) return;

    const isCollectionInLibrary = library.some((game) =>
      getGameCollectionIds(game).includes(selectedCollectionId)
    );

    if (!isCollectionInLibrary) {
      handleCollectionSelect(null);
    }
  }, [
    collections,
    library,
    selectedCollectionId,
    handleCollectionSelect,
    hasLoadedCollections,
    hasFailedToLoadCollections,
    userDetails,
  ]);

  const groupedLibrary = useMemo(
    () => groupLibraryGames(library, runningGameId ? [runningGameId] : []),
    [library, runningGameId]
  );
  const groupedHiddenGames = useMemo(
    () => groupLibraryGames(hiddenGames, runningGameId ? [runningGameId] : []),
    [hiddenGames, runningGameId]
  );
  const librarySortCacheRef = useRef<LibrarySortCache | null>(null);
  const sortedLibrary = useMemo(() => {
    librarySortCacheRef.current = sortLibraryGamesIncrementally(
      librarySortCacheRef.current,
      groupedLibrary,
      sortBy
    );
    return librarySortCacheRef.current.output;
  }, [groupedLibrary, sortBy]);

  const {
    platforms: uniquePlatforms,
    sources: availableSources,
    hasImportedGames,
  } = useMemo(
    () =>
      getLibraryFilterOptions(
        selectedCollectionId === HIDDEN_COLLECTION_ID ? hiddenGames : library
      ),
    [library, hiddenGames, selectedCollectionId]
  );
  const hasPlatforms = uniquePlatforms.length > 0;
  const effectiveSources = useMemo(
    () =>
      hasImportedGames
        ? selectedSources.filter((source) => availableSources.includes(source))
        : [],
    [hasImportedGames, selectedSources, availableSources]
  );
  const showSourceFilter =
    categoryShowsSources(effectiveCategory) && hasImportedGames;
  const showPlatformFilter =
    categoryShowsPlatforms(effectiveCategory) && hasPlatforms;

  const filteredLibrary = useMemo(() => {
    let filtered =
      selectedCollectionId === HIDDEN_COLLECTION_ID
        ? userDetails
          ? sortLibraryGames(groupedHiddenGames, sortBy)
          : []
        : sortedLibrary;

    if (selectedCollectionId) {
      if (selectedCollectionId === FAVORITES_COLLECTION_ID) {
        filtered = filtered.filter((game) => game.favorite);
      } else if (selectedCollectionId === HIDDEN_COLLECTION_ID) {
        // Hidden games are populated by the authenticated owner's private list.
      } else {
        filtered = filtered.filter((game) =>
          getGameCollectionIds(game).includes(selectedCollectionId)
        );
      }
    }

    filtered = filterLibraryGames(filtered, {
      category: effectiveCategory,
      sources: effectiveSources,
      platforms: hasPlatforms ? selectedPlatforms : [],
    });

    if (showInstalledOnly) {
      filtered = filtered.filter(isGameInstalled);
    }

    const queryLower = removeDiacritics(deferredSearchQuery)
      .toLowerCase()
      .trim();

    if (!queryLower) return filtered;

    return filtered.filter((game) =>
      removeDiacritics(game.title ?? "")
        .toLowerCase()
        .includes(queryLower)
    );
  }, [
    sortedLibrary,
    groupedHiddenGames,
    userDetails,
    sortBy,
    deferredSearchQuery,
    selectedCollectionId,
    effectiveCategory,
    effectiveSources,
    hasPlatforms,
    selectedPlatforms,
    showInstalledOnly,
  ]);

  useEffect(() => {
    if (uniquePlatforms.length === 0 || selectedPlatforms.length === 0) return;

    const availablePlatforms = new Set(uniquePlatforms);
    const nextPlatforms = selectedPlatforms.filter((platform) =>
      availablePlatforms.has(platform)
    );

    if (nextPlatforms.length !== selectedPlatforms.length) {
      handlePlatformsChange(nextPlatforms);
    }
  }, [uniquePlatforms, selectedPlatforms, handlePlatformsChange]);

  const favoritesCount = useMemo(() => {
    return groupedLibrary.filter((game) => game.favorite).length;
  }, [groupedLibrary]);

  const libraryCollections = useMemo<GameCollection[]>(() => {
    return [
      {
        id: FAVORITES_COLLECTION_ID,
        name: t("favorites"),
        gamesCount: favoritesCount,
      },
      ...(userDetails &&
      (groupedHiddenGames.length > 0 ||
        selectedCollectionId === HIDDEN_COLLECTION_ID)
        ? [
            {
              id: HIDDEN_COLLECTION_ID,
              name: t("hidden_games"),
              gamesCount: groupedHiddenGames.length,
            },
          ]
        : []),
      ...collections.map((collection) => ({
        ...collection,
        gamesCount: groupedLibrary.filter((game) =>
          getGameCollectionIds(game).includes(collection.id)
        ).length,
      })),
    ];
  }, [
    collections,
    groupedLibrary,
    favoritesCount,
    groupedHiddenGames,
    selectedCollectionId,
    t,
    userDetails,
  ]);

  const columnsCount = useMemo(
    () => getColumnsCount(containerWidth, viewMode),
    [containerWidth, viewMode]
  );

  const gap = viewMode === "large" ? LARGE_GAP : GAP;

  const itemWidth =
    containerWidth > 0
      ? (containerWidth - gap * (columnsCount - 1)) / columnsCount
      : FALLBACK_ITEM_WIDTH;

  const estimatedRowHeight = useMemo(() => {
    if (viewMode === "large") return LARGE_CARD_ESTIMATED_HEIGHT + gap;
    return Math.round((itemWidth * 3) / 2) + gap;
  }, [viewMode, itemWidth, gap]);

  const libraryViewKey = JSON.stringify([
    effectiveCategory,
    selectedSources,
    selectedPlatforms,
    showInstalledOnly,
    sortBy,
    selectedCollectionId,
    viewMode,
  ]);
  libraryViewKeyRef.current = libraryViewKey;

  useEffect(() => {
    if (!scrollRestoreDoneRef.current) return;
    gamesScrollRef.current?.scrollTo({ top: 0 });
    setHeaderHidden(false);
  }, [
    effectiveCategory,
    selectedSources,
    selectedPlatforms,
    showInstalledOnly,
    sortBy,
    selectedCollectionId,
    setHeaderHidden,
  ]);

  const hasGames =
    library.length > 0 ||
    (Boolean(userDetails) && hiddenGames.length > 0) ||
    (selectedCollectionId === HIDDEN_COLLECTION_ID && Boolean(userDetails));
  const showControls = hasGames || Boolean(userDetails);
  const hasNoFilteredGames = filteredLibrary.length === 0;
  const isHiddenCollectionSelected =
    selectedCollectionId === HIDDEN_COLLECTION_ID;
  const isFavoritesCollectionSelected =
    selectedCollectionId === FAVORITES_COLLECTION_ID;
  const shouldShowFavoritesEmptyState =
    hasGames &&
    !isLibraryLoading &&
    isFavoritesCollectionSelected &&
    hasNoFilteredGames;
  const shouldShowCollectionEmptyState =
    hasGames &&
    !isLibraryLoading &&
    !shouldShowFavoritesEmptyState &&
    !(
      isHiddenCollectionSelected &&
      (hiddenGamesLoadFailed || hiddenGamesLoading)
    ) &&
    Boolean(selectedCollectionId) &&
    !isFavoritesCollectionSelected &&
    hasNoFilteredGames;
  const shouldShowClassicsImporting =
    effectiveCategory === "classics" &&
    isImportingClassics &&
    hasNoFilteredGames;
  const shouldShowNoResultsEmptyState =
    hasGames &&
    !isLibraryLoading &&
    hasNoFilteredGames &&
    !shouldShowFavoritesEmptyState &&
    !shouldShowCollectionEmptyState &&
    !(
      isHiddenCollectionSelected &&
      (hiddenGamesLoadFailed || hiddenGamesLoading)
    ) &&
    !shouldShowClassicsImporting;

  const canShowGrid =
    containerWidth > 0 &&
    hasGames &&
    !isLibraryLoading &&
    !shouldShowFavoritesEmptyState &&
    !shouldShowCollectionEmptyState &&
    !shouldShowClassicsImporting &&
    !shouldShowNoResultsEmptyState;

  useLayoutEffect(() => {
    if (scrollRestoreDoneRef.current || !canShowGrid) return;

    const saved = savedLibraryScroll;
    const element = gamesScrollRef.current;
    if (!saved || !element) {
      scrollRestoreDoneRef.current = true;
      return;
    }
    scrollRestoreDoneRef.current = true;
    if (saved.viewKey !== libraryViewKey) {
      setHeaderHidden(false);
      return;
    }

    setHeaderHidden(saved.headerHidden);
    element.scrollTop = saved.top;
  }, [canShowGrid, libraryViewKey, setHeaderHidden]);

  return (
    <section
      className={`library__content${hasGames && isHeaderHidden ? " library__content--header-hidden" : ""}`}
    >
      {showControls && (
        <div
          className={`library__page-header${isHeaderHidden ? " library__page-header--hidden" : ""}`}
        >
          <div className="library__controls-row">
            <div className="library__controls-left">
              <CategoryFilter
                category={effectiveCategory}
                onCategoryChange={handleCategoryChange}
              />
              <CollectionsFilter
                collections={libraryCollections}
                selectedCollectionId={selectedCollectionId}
                favoritesCollectionId={FAVORITES_COLLECTION_ID}
                hiddenCollectionId={HIDDEN_COLLECTION_ID}
                onSelect={handleCollectionSelect}
                onCreate={handleCreateCollectionButtonClick}
                onCollectionContextMenu={openCollectionContextMenu}
              />
              {showSourceFilter && (
                <SourceFilter
                  sources={availableSources}
                  selectedSources={effectiveSources}
                  onSourcesChange={handleSourcesChange}
                />
              )}
              {showPlatformFilter && (
                <PlatformFilter
                  selectedPlatforms={selectedPlatforms}
                  platforms={uniquePlatforms}
                  onPlatformsChange={handlePlatformsChange}
                />
              )}
              <InstalledFilter
                showInstalledOnly={showInstalledOnly}
                onShowInstalledOnlyChange={handleShowInstalledOnlyChange}
              />
            </div>

            <div className="library__controls-right">
              <FilterOptions sortBy={sortBy} onSortChange={handleSortChange} />
              <ViewOptions
                viewMode={viewMode}
                onViewModeChange={handleViewModeChange}
              />
            </div>
          </div>
        </div>
      )}

      {!hasGames && !shouldShowClassicsImporting && !isLibraryLoading && (
        <div className="library__no-games">
          <div className="library__telescope-icon">
            <TelescopeIcon size={24} />
          </div>
          <h2>{t("no_games_title")}</h2>
          <p>{t("no_games_description")}</p>
        </div>
      )}

      {shouldShowClassicsImporting && (
        <div className="library__empty">
          <div className="library__icon-container library__icon-container--spinning">
            <SyncIcon size={24} />
          </div>
          <h2>{t("importing_classics_title")}</h2>
          <p>{t("importing_classics_description")}</p>
        </div>
      )}

      {shouldShowFavoritesEmptyState && (
        <div className="library__empty">
          <div className="library__icon-container">
            <HeartIcon size={24} />
          </div>
          <h2>{t("empty_favorites_title")}</h2>
          <p>{t("empty_favorites_description")}</p>
        </div>
      )}

      {shouldShowCollectionEmptyState && (
        <div className="library__empty">
          <div className="library__icon-container">
            <FileDirectoryIcon size={24} />
          </div>
          <h2>
            {t(
              selectedCollectionId === HIDDEN_COLLECTION_ID
                ? "empty_hidden_title"
                : "empty_collection_title"
            )}
          </h2>
          <p>
            {t(
              selectedCollectionId === HIDDEN_COLLECTION_ID
                ? "empty_hidden_description"
                : "empty_collection_description"
            )}
          </p>
        </div>
      )}

      {hasGames && isHiddenCollectionSelected && hiddenGamesLoading && (
        <div className="library__empty">
          <h2>{t("loading")}</h2>
        </div>
      )}

      {hasGames &&
        isHiddenCollectionSelected &&
        hiddenGamesLoadFailed &&
        !hiddenGamesLoading && (
          <div className="library__empty">
            <h2>{t("hidden_games_load_failed")}</h2>
            <button type="button" onClick={() => void retryHiddenGames()}>
              {t("retry_hidden_games")}
            </button>
          </div>
        )}

      {shouldShowNoResultsEmptyState && (
        <div className="library__empty">
          <div className="library__icon-container">
            <SearchIcon size={24} />
          </div>
          <h2>{t("no_results")}</h2>
          <p>{t("no_results_description")}</p>
        </div>
      )}

      <div
        className="library__games-scroll"
        ref={gamesScrollRef}
        onScroll={handleGamesScroll}
      >
        <div
          className={`library__scroll-shadow${isGamesScrolled && isHeaderHidden ? " library__scroll-shadow--visible" : ""}`}
        />
        {containerWidth > 0 && isLibraryLoading && (
          <LibraryGamesSkeleton
            viewMode={viewMode}
            columns={columnsCount}
            rows={Math.max(
              2,
              Math.ceil(window.innerHeight / estimatedRowHeight)
            )}
            gap={gap}
          />
        )}
        {canShowGrid && (
          <LibraryGamesGrid
            games={filteredLibrary}
            viewMode={viewMode}
            columnsCount={columnsCount}
            itemWidth={itemWidth}
            estimatedRowHeight={estimatedRowHeight}
            gap={gap}
            scrollElementRef={gamesScrollRef}
            getInitialScrollOffset={getInitialScrollOffset}
            onContextMenu={handleOpenContextMenu}
            isScrollbarDragging={isScrollbarDragging}
          />
        )}
      </div>

      {hasGames && (
        <LibraryScrollbar
          scrollElementRef={gamesScrollRef}
          onDraggingChange={setIsScrollbarDragging}
        />
      )}

      {gameContextMenu.game && (
        <GameContextMenu
          game={gameContextMenu.game}
          visible={gameContextMenu.visible}
          position={gameContextMenu.position}
          onClose={handleCloseContextMenu}
          onCollectionContextMenu={openCollectionContextMenu}
        />
      )}

      <CreateCollectionModal
        visible={showCreateCollectionModal}
        onClose={() => setShowCreateCollectionModal(false)}
      />

      <ClassicsOnboardingModal
        visible={showClassicsOnboarding}
        onClose={() => setShowClassicsOnboarding(false)}
      />
    </section>
  );
}
