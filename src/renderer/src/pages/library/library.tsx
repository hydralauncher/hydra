import {
  useDeferredValue,
  useEffect,
  useLayoutEffect,
  useMemo,
  useState,
  useCallback,
  useRef,
} from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
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
import { AuthPage, removeDiacritics } from "@shared";
import { GameCollection, LibraryGame } from "@types";
import { CreateCollectionModal, GameContextMenu } from "@renderer/components";
import { useCollectionContextMenu } from "@renderer/context";
import {
  getGameCollectionIds,
  isGameInstalled,
  sortLibraryGames,
} from "@renderer/helpers";
import { useSearchParams } from "react-router-dom";
import { LibraryGameCard } from "./library-game-card";
import { LibraryGameCardLarge } from "./library-game-card-large";
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
  "recently_downloaded",
  "most_played",
  "achievements",
  "installed_first",
  "title_desc",
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
  const [containerWidth, setContainerWidth] = useState(0);
  const [isGamesScrolled, setIsGamesScrolled] = useState(false);
  const [isHeaderHidden, setIsHeaderHidden] = useState(false);
  const isHeaderHiddenRef = useRef(false);

  const setHeaderHidden = useCallback((next: boolean) => {
    isHeaderHiddenRef.current = next;
    setIsHeaderHidden(next);
  }, []);

  const handleGamesScroll = useCallback(
    (event: React.UIEvent<HTMLDivElement>) => {
      setIsGamesScrolled(event.currentTarget.scrollTop > 0);
    },
    []
  );

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

    setContainerWidth(el.getBoundingClientRect().width);

    const ro = new ResizeObserver(([entry]) =>
      setContainerWidth(entry.contentRect.width)
    );
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

  const sortedLibrary = useMemo(
    () => sortLibraryGames(library, sortBy),
    [library, sortBy]
  );

  const { platforms: uniquePlatforms, hasSteamGames } = useMemo(
    () =>
      getLibraryFilterOptions(
        selectedCollectionId === HIDDEN_COLLECTION_ID ? hiddenGames : library
      ),
    [library, hiddenGames, selectedCollectionId]
  );
  const hasPlatforms = uniquePlatforms.length > 0;
  const showSourceFilter =
    categoryShowsSources(effectiveCategory) && hasSteamGames;
  const showPlatformFilter =
    categoryShowsPlatforms(effectiveCategory) && hasPlatforms;

  const filteredLibrary = useMemo(() => {
    let filtered =
      selectedCollectionId === HIDDEN_COLLECTION_ID
        ? userDetails
          ? sortLibraryGames(hiddenGames, sortBy)
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
      sources: hasSteamGames ? selectedSources : [],
      platforms: hasPlatforms ? selectedPlatforms : [],
    });

    if (showInstalledOnly) {
      filtered = filtered.filter(isGameInstalled);
    }

    const queryLower = removeDiacritics(deferredSearchQuery).toLowerCase();

    if (!queryLower.trim()) return filtered;

    return filtered.filter((game) => {
      const titleLower = removeDiacritics(game.title ?? "").toLowerCase();
      let queryIndex = 0;

      for (
        let i = 0;
        i < titleLower.length && queryIndex < queryLower.length;
        i++
      ) {
        if (titleLower[i] === queryLower[queryIndex]) {
          queryIndex++;
        }
      }

      return queryIndex === queryLower.length;
    });
  }, [
    sortedLibrary,
    hiddenGames,
    userDetails,
    sortBy,
    deferredSearchQuery,
    selectedCollectionId,
    effectiveCategory,
    hasSteamGames,
    selectedSources,
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
    return library.filter((game) => game.favorite).length;
  }, [library]);

  const customGamesCountByCollectionId = useMemo(() => {
    const counts = new Map<string, number>();

    for (const game of library) {
      if (game.shop !== "custom") continue;

      for (const collectionId of getGameCollectionIds(game)) {
        counts.set(collectionId, (counts.get(collectionId) ?? 0) + 1);
      }
    }

    return counts;
  }, [library]);

  const libraryCollections = useMemo<GameCollection[]>(() => {
    return [
      {
        id: FAVORITES_COLLECTION_ID,
        name: t("favorites"),
        gamesCount: favoritesCount,
      },
      ...(userDetails
        ? [
            {
              id: HIDDEN_COLLECTION_ID,
              name: t("hidden_games"),
              gamesCount: hiddenGames.length,
            },
          ]
        : []),
      ...collections.map((collection) => ({
        ...collection,
        gamesCount:
          collection.gamesCount +
          (customGamesCountByCollectionId.get(collection.id) ?? 0),
      })),
    ];
  }, [
    collections,
    customGamesCountByCollectionId,
    favoritesCount,
    hiddenGames.length,
    t,
    userDetails,
  ]);

  const columnsCount = useMemo(
    () => getColumnsCount(containerWidth, viewMode),
    [containerWidth, viewMode]
  );

  const rows = useMemo(() => {
    const result: LibraryGame[][] = [];
    for (let i = 0; i < filteredLibrary.length; i += columnsCount) {
      result.push(filteredLibrary.slice(i, i + columnsCount));
    }
    return result;
  }, [filteredLibrary, columnsCount]);

  const estimatedRowHeight = useMemo(() => {
    if (viewMode === "large") return LARGE_CARD_ESTIMATED_HEIGHT + GAP;
    const itemWidth =
      containerWidth > 0
        ? (containerWidth - GAP * (columnsCount - 1)) / columnsCount
        : FALLBACK_ITEM_WIDTH;
    return Math.round((itemWidth * 3) / 2) + GAP;
  }, [viewMode, containerWidth, columnsCount]);

  const rowVirtualizer = useVirtualizer({
    count: rows.length,
    getScrollElement: () => gamesScrollRef.current,
    estimateSize: () => estimatedRowHeight,
    overscan: 3,
  });

  useEffect(() => {
    rowVirtualizer.measure();
  }, [rowVirtualizer, estimatedRowHeight]);

  useEffect(() => {
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
    hasGames && isFavoritesCollectionSelected && hasNoFilteredGames;
  const shouldShowCollectionEmptyState =
    hasGames &&
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
    hasNoFilteredGames &&
    !shouldShowFavoritesEmptyState &&
    !shouldShowCollectionEmptyState &&
    !(
      isHiddenCollectionSelected &&
      (hiddenGamesLoadFailed || hiddenGamesLoading)
    ) &&
    !shouldShowClassicsImporting;

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
                  selectedSources={selectedSources}
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
            gap={GAP}
          />
        )}
        {containerWidth > 0 &&
          hasGames &&
          !shouldShowFavoritesEmptyState &&
          !shouldShowCollectionEmptyState &&
          !shouldShowClassicsImporting &&
          !shouldShowNoResultsEmptyState && (
            <div
              style={{
                height: `${rowVirtualizer.getTotalSize()}px`,
                position: "relative",
              }}
            >
              {rowVirtualizer.getVirtualItems().map((virtualRow) => (
                <div
                  key={virtualRow.key}
                  style={{
                    position: "absolute",
                    top: 0,
                    left: 0,
                    right: GAP,
                    transform: `translateY(${virtualRow.start}px)`,
                    display: "grid",
                    gridTemplateColumns: `repeat(${columnsCount}, 1fr)`,
                    gap: `${GAP}px`,
                  }}
                >
                  {rows[virtualRow.index].map((game) =>
                    viewMode === "large" ? (
                      <LibraryGameCardLarge
                        key={`${game.shop}-${game.objectId}`}
                        game={game}
                        onContextMenu={handleOpenContextMenu}
                      />
                    ) : (
                      <LibraryGameCard
                        key={`${game.shop}-${game.objectId}`}
                        game={game}
                        onContextMenu={handleOpenContextMenu}
                      />
                    )
                  )}
                </div>
              ))}
            </div>
          )}
      </div>

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
