import {
  useDeferredValue,
  useEffect,
  useLayoutEffect,
  useMemo,
  useState,
  useCallback,
  useRef,
  useSyncExternalStore,
} from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import { combine } from "@atlaskit/pragmatic-drag-and-drop/combine";
import {
  dropTargetForElements,
  monitorForElements,
} from "@atlaskit/pragmatic-drag-and-drop/element/adapter";
import {
  useLibrary,
  useAppDispatch,
  useAppSelector,
  useGameCollections,
  useToast,
  useUserDetails,
} from "@renderer/hooks";
import {
  selectGroupedLibrary,
  selectIsLibraryLoading,
  setHeaderTitle,
} from "@renderer/features";
import {
  HeartIcon,
  TelescopeIcon,
  FileDirectoryIcon,
  PlusIcon,
  SearchIcon,
  SyncIcon,
} from "@primer/octicons-react";
import { useTranslation } from "react-i18next";
import { AuthPage, groupLibraryGames, removeDiacritics } from "@shared";
import { GameCollection, LibraryGame } from "@types";
import {
  Button,
  ConfirmationModal,
  CreateCollectionModal,
  GameContextMenu,
} from "@renderer/components";
import { SidebarAddingCustomGameModal } from "@renderer/components/sidebar/sidebar-adding-custom-game-modal";
import { useCollectionContextMenu, useScanGames } from "@renderer/context";
import {
  getGameCollectionIds,
  isGameInstalled,
  sortLibraryGames,
} from "@renderer/helpers";
import { useSearchParams } from "react-router-dom";
import { LibraryGameCard } from "./library-game-card";
import { LibraryGameCardLarge } from "./library-game-card-large";
import {
  LibraryDisplayMenu,
  type SortOption,
  type ViewMode,
} from "./library-display-menu";
import { CategoryFilter, LibraryCategory } from "./category-filter";
import { LibraryFiltersMenu } from "./library-filters-menu";
import { LibraryGamesSkeleton } from "./library-games-skeleton";
import {
  getLibraryGameOrderKey,
  moveLibraryGameInCustomOrder,
  readLibraryCustomOrder,
  sortLibraryGamesByCustomOrder,
  writeLibraryCustomOrder,
} from "./library-custom-order";
import {
  buildLibraryCollectionOrder,
  expandLibraryCollectionOrder,
  getLibraryCollectionGames,
  hasLibraryCollectionOrder,
  isSameLibraryOrder,
} from "./library-collection-order";
import {
  beginCollectionOrderSave,
  clearSettledCollectionOrders,
  finishCollectionOrderSave,
  getCollectionOrderSaves,
  subscribeCollectionOrderSaves,
} from "./library-collection-order-saves";
import {
  LibrarySortableGame,
  isLibraryGameDragData,
} from "./library-sortable-game";
import {
  createLibraryDragOverlay,
  settleLibraryCard,
  SETTLE_DURATION_MS,
  type LibraryDragOverlay,
} from "./library-drag-overlay";
import {
  findLibraryGridKeyAt,
  getLibraryPlacementBox,
  layoutLibraryGrid,
  type LibraryGridMetrics,
} from "./library-grid-layout";
import { createLibraryDragAutoscroll } from "./library-drag-autoscroll";
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
const LIBRARY_GRID_DROP_TYPE = "library-grid";
const DRAG_MOVE_MIN_DISTANCE = 12;

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

const getContentWidth = (element: HTMLElement) => {
  const style = window.getComputedStyle(element);
  const scrollbarWidth = element.offsetWidth - element.clientWidth;
  return (
    element.getBoundingClientRect().width -
    scrollbarWidth -
    (Number.parseFloat(style.paddingLeft) || 0) -
    (Number.parseFloat(style.paddingRight) || 0)
  );
};

const SORT_OPTIONS: SortOption[] = [
  "title_asc",
  "recently_played",
  "most_played",
  "achievements",
  "installed_first",
  "title_desc",
  "custom",
];

export default function Library() {
  const { library, updateLibrary } = useLibrary();
  const { showErrorToast, showSuccessToast } = useToast();
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
  const [customOrder, setCustomOrder] = useState<string[]>(() =>
    readLibraryCustomOrder(localStorage, accountId)
  );
  useEffect(() => {
    setCustomOrder(readLibraryCustomOrder(localStorage, accountId));
  }, [accountId]);
  const [dragPreview, setDragPreview] = useState<{
    sourceKey: string;
    order: string[];
    restingIndex: ReadonlyMap<string, number>;
  } | null>(null);
  const [isReordering, setIsReordering] = useState(false);
  const collectionOrderSaves = useSyncExternalStore(
    subscribeCollectionOrderSaves,
    getCollectionOrderSaves
  );
  const [showResetCustomOrderModal, setShowResetCustomOrderModal] =
    useState(false);
  const [gameContextMenu, setGameContextMenu] = useState<{
    game: LibraryGame | null;
    visible: boolean;
    position: { x: number; y: number };
  }>({ game: null, visible: false, position: { x: 0, y: 0 } });
  const [showCreateCollectionModal, setShowCreateCollectionModal] =
    useState(false);
  const [showAddGameModal, setShowAddGameModal] = useState(false);
  const { isScanSupported, isScanning, openScanModal } = useScanGames();

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

    setContainerWidth(getContentWidth(el));

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

  const groupedLibrary = useAppSelector(selectGroupedLibrary);
  const groupedHiddenGames = useMemo(
    () => groupLibraryGames(hiddenGames, runningGameId ? [runningGameId] : []),
    [hiddenGames, runningGameId]
  );
  const orderCollectionId =
    selectedCollectionId &&
    selectedCollectionId !== FAVORITES_COLLECTION_ID &&
    selectedCollectionId !== HIDDEN_COLLECTION_ID
      ? selectedCollectionId
      : null;
  const collectionGames = useMemo(
    () =>
      orderCollectionId
        ? getLibraryCollectionGames(
            [...library, ...hiddenGames],
            orderCollectionId
          )
        : [],
    [library, hiddenGames, orderCollectionId]
  );
  const activePendingCollectionOrder = orderCollectionId
    ? (collectionOrderSaves.orders[orderCollectionId] ?? null)
    : null;
  const collectionOrder = useMemo(() => {
    if (!orderCollectionId) return null;

    const sortUnplaced = (unplaced: LibraryGame[]) =>
      sortLibraryGamesByCustomOrder(unplaced, customOrder, (rest) =>
        sortLibraryGames(rest, "title_asc")
      );

    return activePendingCollectionOrder
      ? sortLibraryGamesByCustomOrder(
          collectionGames,
          activePendingCollectionOrder,
          sortUnplaced
        ).map(getLibraryGameOrderKey)
      : buildLibraryCollectionOrder(
          collectionGames,
          orderCollectionId,
          sortUnplaced
        );
  }, [
    collectionGames,
    orderCollectionId,
    customOrder,
    activePendingCollectionOrder,
  ]);
  const savedOrder = collectionOrder ?? customOrder;
  const effectiveOrder = dragPreview?.order ?? savedOrder;
  const canResetOrder = (() => {
    if (!orderCollectionId) return customOrder.length > 0;
    if (activePendingCollectionOrder) {
      return activePendingCollectionOrder.length > 0;
    }
    return hasLibraryCollectionOrder(collectionGames, orderCollectionId);
  })();

  const orderLibraryGames = useCallback(
    (games: LibraryGame[]) =>
      sortBy === "custom"
        ? sortLibraryGamesByCustomOrder(games, effectiveOrder, (unplaced) =>
            sortLibraryGames(unplaced, "title_asc")
          )
        : sortLibraryGames(games, sortBy),
    [sortBy, effectiveOrder]
  );
  const sortedLibrary = useMemo(
    () => orderLibraryGames(groupedLibrary),
    [groupedLibrary, orderLibraryGames]
  );
  const sortedHiddenGames = useMemo(
    () => orderLibraryGames(groupedHiddenGames),
    [groupedHiddenGames, orderLibraryGames]
  );

  const saveCustomOrder = useCallback(
    (order: string[]) => {
      const knownKeys = new Set(
        [...library, ...hiddenGames].map(getLibraryGameOrderKey)
      );
      const hasCurrentHiddenGames =
        !accountId ||
        (hiddenGamesState.ownerId === accountId && !hiddenGamesLoadFailed);
      const nextOrder = hasCurrentHiddenGames
        ? order.filter((key) => knownKeys.has(key))
        : order;

      setCustomOrder(nextOrder);
      writeLibraryCustomOrder(localStorage, accountId, nextOrder);
    },
    [
      library,
      hiddenGames,
      hiddenGamesState.ownerId,
      hiddenGamesLoadFailed,
      accountId,
    ]
  );

  const handleSortChange = useCallback((nextSortBy: SortOption) => {
    setSortBy(nextSortBy);
    localStorage.setItem("library-sort-by", nextSortBy);
  }, []);

  const commitCollectionOrder = useCallback(
    (collectionId: string, games: Pick<LibraryGame, "shop" | "objectId">[]) => {
      beginCollectionOrderSave(collectionId, games.map(getLibraryGameOrderKey));
      return window.electron
        .setCollectionGameOrder(collectionId, games)
        .then(
          () => true,
          () => {
            showErrorToast(t("custom_order_save_failed"));
            return false;
          }
        )
        .finally(finishCollectionOrderSave);
    },
    [showErrorToast, t]
  );

  const hasSettledCollectionOrders =
    collectionOrderSaves.pending === 0 &&
    Object.keys(collectionOrderSaves.orders).length > 0;
  useEffect(() => {
    if (!hasSettledCollectionOrders) return;

    void Promise.allSettled([updateLibrary(), updateHiddenGames()]).then(
      clearSettledCollectionOrders
    );
  }, [hasSettledCollectionOrders, updateLibrary, updateHiddenGames]);

  const commitOrder = useCallback(
    (order: string[]) => {
      if (!orderCollectionId) {
        saveCustomOrder(order);
        return;
      }

      const groups = [...groupedLibrary, ...groupedHiddenGames];
      const nextGames = expandLibraryCollectionOrder(
        order,
        collectionGames,
        groups
      );
      const currentGames = expandLibraryCollectionOrder(
        collectionOrder ?? [],
        collectionGames,
        groups
      );
      if (
        isSameLibraryOrder(
          nextGames.map(getLibraryGameOrderKey),
          currentGames.map(getLibraryGameOrderKey)
        )
      ) {
        return;
      }

      commitCollectionOrder(orderCollectionId, nextGames);
    },
    [
      orderCollectionId,
      saveCustomOrder,
      commitCollectionOrder,
      collectionGames,
      collectionOrder,
      groupedLibrary,
      groupedHiddenGames,
    ]
  );

  const handleResetCustomOrder = useCallback(() => {
    setShowResetCustomOrderModal(false);

    if (orderCollectionId) {
      void commitCollectionOrder(orderCollectionId, []).then((saved) => {
        if (saved) showSuccessToast(t("custom_order_reset"));
      });
      return;
    }

    setCustomOrder([]);
    writeLibraryCustomOrder(localStorage, accountId, []);
    showSuccessToast(t("custom_order_reset"));
  }, [
    orderCollectionId,
    commitCollectionOrder,
    accountId,
    showSuccessToast,
    t,
  ]);

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
          ? sortedHiddenGames
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
    sortedHiddenGames,
    userDetails,
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

  const isCustomOrder = sortBy === "custom";
  const gridRef = useRef<HTMLDivElement>(null);
  const pendingSettleRef = useRef<{ key: string; fromRect: DOMRect } | null>(
    null
  );

  const gridMetrics = useMemo<LibraryGridMetrics>(() => {
    const availableWidth =
      containerWidth > 0
        ? containerWidth - GAP
        : FALLBACK_ITEM_WIDTH * columnsCount;
    const cellWidth =
      (availableWidth - GAP * (columnsCount - 1)) / columnsCount;
    const cellHeight =
      viewMode === "large"
        ? LARGE_CARD_ESTIMATED_HEIGHT
        : Math.round((cellWidth * 3) / 2);
    return { cellWidth, cellHeight, gap: GAP };
  }, [containerWidth, columnsCount, viewMode]);
  const estimatedRowHeight = gridMetrics.cellHeight + GAP;

  const gamesByKey = useMemo(
    () =>
      new Map(
        filteredLibrary.map((game) => [getLibraryGameOrderKey(game), game])
      ),
    [filteredLibrary]
  );

  const gridLayout = useMemo(
    () =>
      layoutLibraryGrid(
        filteredLibrary.map(getLibraryGameOrderKey),
        columnsCount
      ),
    [filteredLibrary, columnsCount]
  );

  const dragStateRef = useRef({
    savedOrder,
    commitOrder,
    dragPreview,
    displayedGames: sortedLibrary,
    gridLayout,
    gridMetrics,
  });
  dragStateRef.current = {
    savedOrder,
    commitOrder,
    dragPreview,
    displayedGames:
      selectedCollectionId === HIDDEN_COLLECTION_ID
        ? sortedHiddenGames
        : sortedLibrary,
    gridLayout,
    gridMetrics,
  };

  useEffect(() => {
    const scrollElement = gamesScrollRef.current;
    if (!isCustomOrder || !scrollElement) return;

    let overlay: LibraryDragOverlay | null = null;
    let lastMovePoint: { x: number; y: number } | null = null;
    const removeOverlay = () => {
      const rect = overlay?.getRect() ?? null;
      overlay?.remove();
      overlay = null;
      return rect;
    };
    const autoscroll = createLibraryDragAutoscroll(
      () => gamesScrollRef.current
    );

    let pointer: { clientX: number; clientY: number } | null = null;
    let activeSourceKey: string | null = null;
    let reorderEndTimeout: number | undefined;
    let dragStartGames: LibraryGame[] = [];

    const previewMoveOnto = (sourceKey: string, targetKey: string) => {
      const {
        savedOrder: committedOrder,
        dragPreview: preview,
        displayedGames,
      } = dragStateRef.current;
      const sourceIndex = displayedGames.findIndex(
        (game) => getLibraryGameOrderKey(game) === sourceKey
      );
      const targetIndex = displayedGames.findIndex(
        (game) => getLibraryGameOrderKey(game) === targetKey
      );
      if (sourceIndex === -1 || targetIndex === -1) return false;

      const order = moveLibraryGameInCustomOrder(
        preview?.order ?? committedOrder,
        displayedGames,
        sourceKey,
        targetKey,
        sourceIndex < targetIndex ? "after" : "before"
      );
      setDragPreview((current) =>
        current ? { ...current, sourceKey, order } : current
      );
      return true;
    };

    const updateHoveredSlot = () => {
      const grid = gridRef.current;
      if (!pointer || !activeSourceKey || !grid) return;

      const rect = grid.getBoundingClientRect();
      const point = {
        x: pointer.clientX - rect.left,
        y: pointer.clientY - rect.top,
      };
      if (
        lastMovePoint &&
        Math.hypot(point.x - lastMovePoint.x, point.y - lastMovePoint.y) <
          DRAG_MOVE_MIN_DISTANCE
      ) {
        return;
      }

      const { gridLayout: layout, gridMetrics: metrics } = dragStateRef.current;
      const hoveredKey = findLibraryGridKeyAt(
        layout,
        metrics,
        point.x,
        point.y
      );
      if (
        hoveredKey &&
        hoveredKey !== activeSourceKey &&
        previewMoveOnto(activeSourceKey, hoveredKey)
      ) {
        lastMovePoint = point;
      }
    };

    scrollElement.addEventListener("scroll", updateHoveredSlot, {
      passive: true,
    });

    return combine(
      dropTargetForElements({
        element: scrollElement,
        canDrop: ({ source }) => isLibraryGameDragData(source.data),
        getData: () => ({ type: LIBRARY_GRID_DROP_TYPE }),
      }),
      monitorForElements({
        canMonitor: ({ source }) => isLibraryGameDragData(source.data),
        onDragStart: ({ source, location }) => {
          if (!isLibraryGameDragData(source.data)) return;
          removeOverlay();
          lastMovePoint = null;
          activeSourceKey = source.data.orderKey;
          window.clearTimeout(reorderEndTimeout);
          setIsReordering(true);
          dragStartGames = dragStateRef.current.displayedGames;
          pointer = location.current.input;
          overlay = createLibraryDragOverlay(
            source.element,
            location.current.input
          );
          setDragPreview({
            sourceKey: source.data.orderKey,
            order: dragStateRef.current.savedOrder,
            restingIndex: new Map(
              dragStateRef.current.gridLayout.placements.map(
                (placement, index) => [placement.key, index]
              )
            ),
          });
        },
        onDrag: ({ location }) => {
          pointer = location.current.input;
          overlay?.move(location.current.input);
          autoscroll.update(location.current.input.clientY);
          updateHoveredSlot();
        },
        onDrop: ({ source, location }) => {
          activeSourceKey = null;
          pointer = null;
          autoscroll.stop();
          const overlayRect = removeOverlay();
          const { dragPreview: preview, commitOrder: commit } =
            dragStateRef.current;
          const isInsideGrid = location.current.dropTargets.length > 0;
          const hasMoved =
            preview !== null &&
            !isSameLibraryOrder(
              sortLibraryGamesByCustomOrder(
                dragStartGames,
                preview.order,
                (games) => sortLibraryGames(games, "title_asc")
              ).map(getLibraryGameOrderKey),
              dragStartGames.map(getLibraryGameOrderKey)
            );

          if (preview && isInsideGrid && hasMoved) {
            commit(preview.order);

            if (isLibraryGameDragData(source.data) && overlayRect) {
              pendingSettleRef.current = {
                key: source.data.orderKey,
                fromRect: overlayRect,
              };
            }
          }
          setDragPreview(null);
          reorderEndTimeout = window.setTimeout(
            () => setIsReordering(false),
            SETTLE_DURATION_MS
          );
        },
      }),
      () => {
        scrollElement.removeEventListener("scroll", updateHoveredSlot);
        autoscroll.stop();
        removeOverlay();
        window.clearTimeout(reorderEndTimeout);
        setDragPreview(null);
        setIsReordering(false);
      }
    );
  }, [isCustomOrder]);

  const rowVirtualizer = useVirtualizer({
    count: gridLayout.rowCount,
    getScrollElement: () => gamesScrollRef.current,
    estimateSize: () => estimatedRowHeight,
    overscan: 3,
  });

  useEffect(() => {
    rowVirtualizer.measure();
  }, [rowVirtualizer, estimatedRowHeight]);

  const virtualRows = rowVirtualizer.getVirtualItems();
  const firstVisibleRow = virtualRows[0]?.index ?? 0;
  const lastVisibleRow = virtualRows[virtualRows.length - 1]?.index ?? -1;
  const visiblePlacements = gridLayout.placements.slice(
    firstVisibleRow * gridLayout.columnCount,
    (lastVisibleRow + 1) * gridLayout.columnCount
  );

  const renderedPlacements = dragPreview
    ? [...visiblePlacements].sort(
        (a, b) =>
          (dragPreview.restingIndex.get(a.key) ?? Number.MAX_SAFE_INTEGER) -
          (dragPreview.restingIndex.get(b.key) ?? Number.MAX_SAFE_INTEGER)
      )
    : visiblePlacements;

  useLayoutEffect(() => {
    const settle = pendingSettleRef.current;
    if (!settle || dragPreview) return;
    pendingSettleRef.current = null;

    const element = gridRef.current?.querySelector<HTMLElement>(
      `[data-library-order-key="${CSS.escape(settle.key)}"]`
    );
    if (element) settleLibraryCard(element, settle.fromRect);
  }, [dragPreview]);

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

  return (
    <section
      className={`library__content${hasGames && isHeaderHidden ? " library__content--header-hidden" : ""}`}
    >
      {/* Hides on scroll down and comes back on scroll up. Without games
          there is nothing to scroll, so adding one stays in reach. */}
      <div
        className={`library__page-header${hasGames && isHeaderHidden ? " library__page-header--hidden" : ""}`}
      >
        <div className="library__toolbar">
          {showControls && (
            <>
              <CategoryFilter
                category={effectiveCategory}
                onCategoryChange={handleCategoryChange}
              />

              <LibraryFiltersMenu
                collections={libraryCollections}
                selectedCollectionId={selectedCollectionId}
                favoritesCollectionId={FAVORITES_COLLECTION_ID}
                hiddenCollectionId={HIDDEN_COLLECTION_ID}
                onCollectionSelect={handleCollectionSelect}
                onCollectionCreate={handleCreateCollectionButtonClick}
                onCollectionContextMenu={openCollectionContextMenu}
                showSources={showSourceFilter}
                sources={availableSources}
                selectedSources={effectiveSources}
                onSourcesChange={handleSourcesChange}
                showPlatforms={showPlatformFilter}
                platforms={uniquePlatforms}
                selectedPlatforms={selectedPlatforms}
                onPlatformsChange={handlePlatformsChange}
                showInstalledOnly={showInstalledOnly}
                onShowInstalledOnlyChange={handleShowInstalledOnlyChange}
              />
            </>
          )}

          <div className="library__actions">
            {showControls && (
              <LibraryDisplayMenu
                sortBy={sortBy}
                onSortChange={handleSortChange}
                viewMode={viewMode}
                onViewModeChange={handleViewModeChange}
                canResetCustomOrder={canResetOrder}
                onResetCustomOrder={() => setShowResetCustomOrderModal(true)}
              />
            )}

            {isScanSupported ? (
              <>
                <Button
                  theme="outline"
                  className="library__action library__action--icon"
                  onClick={() => setShowAddGameModal(true)}
                  aria-label={t("add_custom_game_tooltip", { ns: "sidebar" })}
                  tooltip={t("add_custom_game_tooltip", { ns: "sidebar" })}
                  tooltipPlace="bottom"
                  tooltipInPortal
                >
                  <PlusIcon size={16} />
                </Button>

                <Button
                  theme="primary"
                  className={`library__action${isScanning ? " library__action--scanning" : ""}`}
                  onClick={openScanModal}
                >
                  <SyncIcon size={16} />
                  {t("scan_games", { ns: "header" })}
                </Button>
              </>
            ) : (
              <Button
                theme="primary"
                className="library__action"
                onClick={() => setShowAddGameModal(true)}
              >
                <PlusIcon size={16} />
                {t("add_game", { ns: "header" })}
              </Button>
            )}
          </div>
        </div>
      </div>

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
          !isLibraryLoading &&
          !shouldShowFavoritesEmptyState &&
          !shouldShowCollectionEmptyState &&
          !shouldShowClassicsImporting &&
          !shouldShowNoResultsEmptyState && (
            <div
              ref={gridRef}
              style={{
                height: `${rowVirtualizer.getTotalSize()}px`,
                position: "relative",
                marginRight: GAP,
              }}
            >
              {renderedPlacements.map((placement) => {
                const game = gamesByKey.get(placement.key);
                if (!game) return null;

                const box = getLibraryPlacementBox(placement, gridMetrics);

                return (
                  <LibrarySortableGame
                    key={placement.key}
                    orderKey={placement.key}
                    enabled={isCustomOrder}
                    animated={isReordering}
                    isDragSource={dragPreview?.sourceKey === placement.key}
                    style={{
                      transform: `translate3d(${box.left}px, ${box.top}px, 0)`,
                      width: box.width,
                      height: box.height,
                    }}
                  >
                    {viewMode === "large" ? (
                      <LibraryGameCardLarge
                        game={game}
                        onContextMenu={handleOpenContextMenu}
                      />
                    ) : (
                      <LibraryGameCard
                        game={game}
                        onContextMenu={handleOpenContextMenu}
                      />
                    )}
                  </LibrarySortableGame>
                );
              })}
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

      <ConfirmationModal
        visible={showResetCustomOrderModal}
        title={t("reset_custom_order_title")}
        descriptionText={
          orderCollectionId
            ? t("reset_collection_order_description")
            : t("reset_custom_order_description")
        }
        confirmButtonLabel={t("reset_custom_order_confirm")}
        cancelButtonLabel={t("cancel", { ns: "sidebar" })}
        confirmButtonTheme="danger"
        onClose={() => setShowResetCustomOrderModal(false)}
        onConfirm={handleResetCustomOrder}
      />

      <CreateCollectionModal
        visible={showCreateCollectionModal}
        onClose={() => setShowCreateCollectionModal(false)}
      />

      <SidebarAddingCustomGameModal
        visible={showAddGameModal}
        onClose={() => setShowAddGameModal(false)}
      />

      <ClassicsOnboardingModal
        visible={showClassicsOnboarding}
        onClose={() => setShowClassicsOnboarding(false)}
      />
    </section>
  );
}
