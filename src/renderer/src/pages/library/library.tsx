import { useEffect, useMemo, useState, useCallback } from "react";
import { AnimatePresence, motion } from "framer-motion";
import {
  useLibrary,
  useAppDispatch,
  useAppSelector,
  useGameCollections,
  useToast,
} from "@renderer/hooks";
import { setHeaderTitle, setLibrarySearchQuery } from "@renderer/features";
import {
  HeartIcon,
  TelescopeIcon,
  FileDirectoryIcon,
  PencilIcon,
  TrashIcon,
  SearchIcon,
  ChevronLeftIcon,
  PlusIcon,
  CheckIcon,
  XIcon,
} from "@primer/octicons-react";
import { useTranslation } from "react-i18next";
import { GameCollection, LibraryGame } from "@types";
import {
  Button,
  ConfirmationModal,
  ContextMenu,
  GameContextMenu,
  Modal,
  TextField,
} from "@renderer/components";
import { useSearchParams } from "react-router-dom";
import { useDownload } from "@renderer/hooks";
import { LibraryGameCard } from "./library-game-card";
import { ViewOptions, ViewMode } from "./view-options";
import { FilterOptions, SortOption } from "./filter-options";
import { LibraryCatalogueView } from "./library-catalogue-view";
import "./library.scss";
import {
  matchesAcronym,
  expandAcronym,
} from "@renderer/services/game-acronyms";
import { useHomeGroups } from "@renderer/hooks/use-home-groups";
import { AddCustomGameModal } from "./add-custom-game-modal";
import { PlatformFilter, PlatformTab } from "./platform-filter";

const FAVORITES_COLLECTION_ID = "__favorites__";
const SORT_OPTIONS: SortOption[] = [
  "title_asc",
  "recently_played",
  "most_played",
  "installed_first",
  "title_desc",
];

const getGameCollectionIds = (game: LibraryGame): string[] => {
  if (Array.isArray(game.collectionIds)) {
    return game.collectionIds;
  }

  const legacyCollectionId = (game as { collectionId?: string | null })
    .collectionId;

  return legacyCollectionId ? [legacyCollectionId] : [];
};

export default function Library() {
  const { library, updateLibrary } = useLibrary();
  const {
    groups: homeGroups,
    createGroup,
    updateGroup,
    deleteGroup,
    removeGameFromGroup,
    removeGamesFromGroup,
  } = useHomeGroups();
  const { showSuccessToast, showErrorToast } = useToast();
  const { removeGameFromLibrary, cancelDownload, lastPacket } = useDownload();
  const {
    collections,
    loadCollections,
    hasLoaded: hasLoadedCollections,
  } = useGameCollections();
  const [searchParams, setSearchParams] = useSearchParams();

  const [platformTab, setPlatformTab] = useState<PlatformTab>("all");

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
  const [collectionContextMenu, setCollectionContextMenu] = useState<{
    collection: GameCollection | null;
    visible: boolean;
    position: { x: number; y: number };
  }>({ collection: null, visible: false, position: { x: 0, y: 0 } });
  const [activeCollection, setActiveCollection] =
    useState<GameCollection | null>(null);
  const [showRenameCollectionModal, setShowRenameCollectionModal] =
    useState(false);
  const [collectionName, setCollectionName] = useState("");
  const [isRenamingCollection, setIsRenamingCollection] = useState(false);
  const [showDeleteCollectionModal, setShowDeleteCollectionModal] =
    useState(false);
  const [isDeletingCollection, setIsDeletingCollection] = useState(false);

  const [gameToRemove, setGameToRemove] = useState<LibraryGame | null>(null);
  const [isRemovingGame, setIsRemovingGame] = useState(false);
  const [showAddCustomGameModal, setShowAddCustomGameModal] = useState(false);
  const [selectedGameIds, setSelectedGameIds] = useState<Set<string>>(
    new Set()
  );
  const [showFolderPicker, setShowFolderPicker] = useState(false);
  const [folderPickerSelectedIds, setFolderPickerSelectedIds] = useState<
    Set<string>
  >(new Set());
  const [folderPickerName, setFolderPickerName] = useState("");

  const searchQuery = useAppSelector((state) => state.library.searchQuery);
  const dispatch = useAppDispatch();
  const { t } = useTranslation(["library", "sidebar"]);

  const selectedCollectionId = searchParams.get("collection");
  const action = searchParams.get("action");

  useEffect(() => {
    if (selectedCollectionId === "new" && !showFolderPicker) {
      setFolderPickerSelectedIds(new Set());
      setFolderPickerName("");
      setShowFolderPicker(true);
    } else if (
      action === "edit" &&
      selectedCollectionId &&
      homeGroups.length > 0 &&
      !showFolderPicker
    ) {
      const folder = homeGroups.find((g) => g.id === selectedCollectionId);
      if (folder) {
        setFolderPickerSelectedIds(new Set((folder.gameIds ?? []).map(String)));
        setFolderPickerName(folder.name);
        setShowFolderPicker(true);
        const params = new URLSearchParams(searchParams);
        params.delete("action");
        setSearchParams(params, { replace: true });
      }
    } else if (!selectedCollectionId && showFolderPicker) {
      setShowFolderPicker(false);
    }
  }, [
    selectedCollectionId,
    action,
    homeGroups,
    showFolderPicker,
    searchParams,
    setSearchParams,
  ]);

  const handleCollectionSelect = useCallback(
    (collectionId: string | null) => {
      const params = new URLSearchParams(searchParams);

      if (collectionId) {
        params.set("collection", collectionId);
      } else {
        params.delete("collection");
      }

      setSelectedGameIds(new Set());
      setShowFolderPicker(false);
      setSearchParams(params, { replace: true });
    },
    [searchParams, setSearchParams]
  );

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
      void loadCollections();
    });

    window.electron.refreshLibraryAssets().finally(() => {
      const collectionsPromise = hasLoadedCollections
        ? Promise.resolve([])
        : loadCollections();

      void Promise.all([updateLibrary(), collectionsPromise]);
    });

    return () => {
      unsubscribe();
    };
  }, [dispatch, t, updateLibrary, loadCollections, hasLoadedCollections]);

  const handleOnMouseEnterGameCard = useCallback(() => {
    // Optional: pause animations if needed
  }, []);

  const handleOnMouseLeaveGameCard = useCallback(() => {
    // Optional: resume animations if needed
  }, []);

  const handleOpenContextMenu = useCallback(
    (game: LibraryGame, position: { x: number; y: number }) => {
      setGameContextMenu({ game, visible: true, position });
    },
    []
  );

  const handleCloseContextMenu = useCallback(() => {
    setGameContextMenu((prev) => ({ ...prev, visible: false }));
  }, []);

  const handleToggleFavorite = useCallback(
    async (game: LibraryGame) => {
      if (game.favorite) {
        await window.electron.removeGameFromFavorites(game.shop, game.objectId);
      } else {
        await window.electron.addGameToFavorites(game.shop, game.objectId);
      }
      updateLibrary();
    },
    [updateLibrary]
  );

  const handleToggleSelectGame = useCallback((game: LibraryGame) => {
    setSelectedGameIds((prev) => {
      const next = new Set(prev);
      if (next.has(game.objectId)) {
        next.delete(game.objectId);
      } else {
        next.add(game.objectId);
      }
      return next;
    });
  }, []);

  const handleSelectAll = useCallback((gameIds: string[]) => {
    setSelectedGameIds((prev) => {
      const allSelected = gameIds.every((id) => prev.has(id));
      if (allSelected) return new Set();
      return new Set(gameIds);
    });
  }, []);

  const handleRemoveSelectedFromFolder = useCallback(() => {
    if (!selectedCollectionId) return;
    removeGamesFromGroup(selectedCollectionId, Array.from(selectedGameIds));
    setSelectedGameIds(new Set());
  }, [selectedCollectionId, selectedGameIds, removeGamesFromGroup]);

  const handleRemoveFromFolder = useCallback(
    (game: LibraryGame) => {
      if (!selectedCollectionId) return;
      removeGameFromGroup(selectedCollectionId, game.objectId);
    },
    [selectedCollectionId, removeGameFromGroup]
  );

  const handleOpenFolderPicker = useCallback(() => {
    const folder = homeGroups.find((g) => g.id === selectedCollectionId);
    // Ensure all ids are strings to avoid type mismatch (number vs string)
    setFolderPickerSelectedIds(new Set((folder?.gameIds ?? []).map(String)));
    setFolderPickerName(folder?.name ?? "");
    setShowFolderPicker(true);
  }, [homeGroups, selectedCollectionId]);

  const handleFolderPickerToggle = useCallback((game: LibraryGame) => {
    const id = String(game.objectId);
    setFolderPickerSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  }, []);

  const handleFolderPickerConfirm = useCallback(() => {
    if (!selectedCollectionId) return;

    const trimmedName = folderPickerName.trim();
    if (!trimmedName) {
      showErrorToast(
        t("collection_name_required", {
          defaultValue: "O nome da pasta é obrigatório",
        })
      );
      return;
    }

    if (selectedCollectionId === "new") {
      createGroup(trimmedName, Array.from(folderPickerSelectedIds));
      const params = new URLSearchParams(searchParams);
      params.delete("collection");
      setSearchParams(params, { replace: true });
    } else {
      const folder = homeGroups.find((g) => g.id === selectedCollectionId);
      if (folder) {
        updateGroup(
          selectedCollectionId,
          trimmedName,
          Array.from(folderPickerSelectedIds)
        );
      }
    }

    setShowFolderPicker(false);
    setFolderPickerSelectedIds(new Set());
    setFolderPickerName("");
  }, [
    selectedCollectionId,
    homeGroups,
    folderPickerSelectedIds,
    folderPickerName,
    updateGroup,
    createGroup,
    showErrorToast,
    t,
    searchParams,
    setSearchParams,
  ]);

  const handleFolderPickerCancel = useCallback(() => {
    setShowFolderPicker(false);
    setFolderPickerSelectedIds(new Set());
    setFolderPickerName("");
    if (selectedCollectionId === "new") {
      const params = new URLSearchParams(searchParams);
      params.delete("collection");
      setSearchParams(params, { replace: true });
    }
  }, [selectedCollectionId, searchParams, setSearchParams]);

  const handleRemoveFromLibrary = useCallback(
    async (game: LibraryGame) => {
      setIsRemovingGame(true);
      try {
        const isDownloading =
          game.download?.status === "active" && lastPacket?.gameId === game.id;
        if (isDownloading) {
          await cancelDownload(game.shop, game.objectId);
        }
        await removeGameFromLibrary(game.shop, game.objectId);
        await updateLibrary();
        showSuccessToast(
          t("game_removed_from_library", {
            ns: "game_details",
            defaultValue: "Jogo removido da biblioteca",
          })
        );
      } catch {
        showErrorToast(
          t("failed_remove_from_library", {
            ns: "game_details",
            defaultValue: "Erro ao remover da biblioteca",
          })
        );
      } finally {
        setIsRemovingGame(false);
        setGameToRemove(null);
      }
    },
    [
      cancelDownload,
      lastPacket,
      removeGameFromLibrary,
      showErrorToast,
      showSuccessToast,
      t,
      updateLibrary,
    ]
  );

  const handleOpenCollectionContextMenu = useCallback(
    (
      event: React.MouseEvent<HTMLButtonElement>,
      collection: GameCollection
    ) => {
      event.preventDefault();

      setCollectionContextMenu({
        collection,
        visible: true,
        position: { x: event.clientX, y: event.clientY },
      });
    },
    []
  );

  const handleCloseCollectionContextMenu = useCallback(() => {
    setCollectionContextMenu((prev) => ({ ...prev, visible: false }));
  }, []);

  const resolveCollectionErrorMessage = useCallback(
    (
      error: unknown,
      fallbackKey: "failed_rename_collection" | "failed_delete_collection"
    ) => {
      if (!(error instanceof Error)) return t(fallbackKey);

      if (error.message.includes("game/collection-name-already-in-use")) {
        return t("collection_name_already_in_use", { ns: "sidebar" });
      }

      if (error.message.includes("game/collection-name-required")) {
        return t("collection_name_required", { ns: "sidebar" });
      }

      return t(fallbackKey);
    },
    [t]
  );

  const handleOpenRenameCollectionModal = useCallback(() => {
    const collection = collectionContextMenu.collection;
    if (!collection) return;

    setActiveCollection(collection);
    setCollectionName(collection.name);
    setShowRenameCollectionModal(true);
    handleCloseCollectionContextMenu();
  }, [collectionContextMenu.collection, handleCloseCollectionContextMenu]);

  const handleCloseRenameCollectionModal = useCallback(() => {
    if (isRenamingCollection) return;

    setShowRenameCollectionModal(false);
    setCollectionName("");
    setActiveCollection(null);
  }, [isRenamingCollection]);

  const handleRenameCollection = useCallback(async () => {
    if (!activeCollection) return;

    const nextName = collectionName.trim();
    if (!nextName) {
      showErrorToast(t("collection_name_required", { ns: "sidebar" }));
      return;
    }

    if (nextName === activeCollection.name.trim()) {
      handleCloseRenameCollectionModal();
      return;
    }

    setIsRenamingCollection(true);

    try {
      await window.electron.hydraApi.put(
        `/profile/games/collections/${activeCollection.id}`,
        {
          data: { name: nextName },
          needsAuth: true,
        }
      );

      await loadCollections();
      showSuccessToast(t("collection_renamed"));
      handleCloseRenameCollectionModal();
    } catch (error) {
      showErrorToast(
        resolveCollectionErrorMessage(error, "failed_rename_collection")
      );
    } finally {
      setIsRenamingCollection(false);
    }
  }, [
    activeCollection,
    collectionName,
    handleCloseRenameCollectionModal,
    loadCollections,
    resolveCollectionErrorMessage,
    showErrorToast,
    showSuccessToast,
    t,
  ]);

  const handleOpenDeleteCollectionModal = useCallback(() => {
    const collection = collectionContextMenu.collection;
    if (!collection) return;

    setActiveCollection(collection);
    setShowDeleteCollectionModal(true);
    handleCloseCollectionContextMenu();
  }, [collectionContextMenu.collection, handleCloseCollectionContextMenu]);

  const handleCloseDeleteCollectionModal = useCallback(() => {
    if (isDeletingCollection) return;

    setShowDeleteCollectionModal(false);
    setActiveCollection(null);
  }, [isDeletingCollection]);

  const handleDeleteCollection = useCallback(async () => {
    if (!activeCollection) return;

    setIsDeletingCollection(true);

    try {
      await window.electron.hydraApi.delete(
        `/profile/games/collections/${activeCollection.id}`,
        { needsAuth: true }
      );

      if (selectedCollectionId === activeCollection.id) {
        handleCollectionSelect(null);
      }

      await Promise.all([loadCollections(), updateLibrary()]);
      showSuccessToast(t("collection_deleted"));
      handleCloseDeleteCollectionModal();
    } catch (error) {
      showErrorToast(
        resolveCollectionErrorMessage(error, "failed_delete_collection")
      );
    } finally {
      setIsDeletingCollection(false);
    }
  }, [
    activeCollection,
    selectedCollectionId,
    handleCollectionSelect,
    loadCollections,
    updateLibrary,
    showSuccessToast,
    t,
    handleCloseDeleteCollectionModal,
    showErrorToast,
    resolveCollectionErrorMessage,
  ]);

  const collectionContextMenuItems = useMemo(() => {
    const isCollectionActionBusy = isRenamingCollection || isDeletingCollection;

    return [
      {
        id: "rename-collection",
        label: t("rename_collection"),
        icon: <PencilIcon size={16} />,
        onClick: handleOpenRenameCollectionModal,
        disabled: isCollectionActionBusy,
      },
      {
        id: "delete-collection",
        label: t("delete_collection"),
        icon: <TrashIcon size={16} />,
        onClick: handleOpenDeleteCollectionModal,
        danger: true,
        disabled: isCollectionActionBusy,
      },
    ];
  }, [
    handleOpenDeleteCollectionModal,
    handleOpenRenameCollectionModal,
    isDeletingCollection,
    isRenamingCollection,
    t,
  ]);

  useEffect(() => {
    if (!selectedCollectionId) return;
    if (!hasLoadedCollections) return;
    if (selectedCollectionId === FAVORITES_COLLECTION_ID) return;
    if (selectedCollectionId === "new") return;

    const hasCollection =
      collections.some(
        (collection) => collection.id === selectedCollectionId
      ) || homeGroups.some((group) => group.id === selectedCollectionId);

    if (!hasCollection) {
      handleCollectionSelect(null);
    }
  }, [
    collections,
    homeGroups,
    selectedCollectionId,
    handleCollectionSelect,
    hasLoadedCollections,
  ]);

  const filteredLibrary = useMemo(() => {
    let filtered = library;

    if (platformTab !== "all") {
      filtered = filtered.filter((game) => {
        const isSteam = game.executablePath?.startsWith("steam://");
        const isEpic = game.executablePath?.startsWith(
          "com.epicgames.launcher://"
        );

        if (platformTab === "steam") return isSteam;
        if (platformTab === "epic") return isEpic;
        if (platformTab === "hydra") return !isSteam && !isEpic;
        return true;
      });
    }

    if (selectedCollectionId && !showFolderPicker) {
      if (selectedCollectionId === FAVORITES_COLLECTION_ID) {
        filtered = filtered.filter((game) => game.favorite);
      } else {
        const homeGroup = homeGroups.find((g) => g.id === selectedCollectionId);
        if (homeGroup) {
          filtered = filtered.filter((game) =>
            homeGroup.gameIds.includes(game.objectId)
          );
        } else {
          filtered = filtered.filter((game) =>
            getGameCollectionIds(game).includes(selectedCollectionId)
          );
        }
      }
    }

    if (!searchQuery.trim()) return filtered;

    const queryLower = searchQuery.toLowerCase();
    const expandedQuery = expandAcronym(queryLower);

    return filtered.filter((game) => {
      if (matchesAcronym(queryLower, game.title)) return true;

      const compareTarget = expandedQuery || queryLower;
      const titleLower = game.title.toLowerCase();

      if (expandedQuery && titleLower.includes(expandedQuery)) return true;

      let queryIndex = 0;
      for (
        let i = 0;
        i < titleLower.length && queryIndex < compareTarget.length;
        i++
      ) {
        if (titleLower[i] === compareTarget[queryIndex]) {
          queryIndex++;
        }
      }

      return queryIndex === compareTarget.length;
    });
  }, [
    library,
    searchQuery,
    selectedCollectionId,
    platformTab,
    homeGroups,
    showFolderPicker,
  ]);

  const sortedLibrary = useMemo(() => {
    return [...filteredLibrary].sort((a, b) => {
      switch (sortBy) {
        case "recently_played": {
          const aHasPlayed = a.lastTimePlayed !== null;
          const bHasPlayed = b.lastTimePlayed !== null;

          if (aHasPlayed && bHasPlayed) {
            const aLastPlayed = new Date(a.lastTimePlayed as Date).getTime();
            const bLastPlayed = new Date(b.lastTimePlayed as Date).getTime();
            const lastPlayedDifference = bLastPlayed - aLastPlayed;
            if (lastPlayedDifference !== 0) return lastPlayedDifference;
          } else if (aHasPlayed !== bHasPlayed) {
            return aHasPlayed ? -1 : 1;
          }

          break;
        }

        case "most_played": {
          const playTimeDifference =
            b.playTimeInMilliseconds - a.playTimeInMilliseconds;
          if (playTimeDifference !== 0) return playTimeDifference;
          break;
        }

        case "installed_first": {
          const aIsInstalled =
            Boolean(a.executablePath) || a.installedSizeInBytes != null;
          const bIsInstalled =
            Boolean(b.executablePath) || b.installedSizeInBytes != null;

          if (aIsInstalled !== bIsInstalled) {
            return aIsInstalled ? -1 : 1;
          }

          break;
        }

        case "title_desc": {
          return b.title.localeCompare(a.title, undefined, {
            sensitivity: "base",
          });
        }

        case "title_asc":
        default:
          break;
      }

      return a.title.localeCompare(b.title, undefined, {
        sensitivity: "base",
      });
    });
  }, [filteredLibrary, sortBy]);

  const libraryCollections = useMemo(() => {
    const getBestImage = (g: LibraryGame) =>
      g.customIconUrl || g.coverImageUrl || g.libraryImageUrl || g.iconUrl;

    return [
      ...collections.map((c) => {
        const cGames = library.filter((game) =>
          getGameCollectionIds(game).includes(c.id)
        );
        return {
          id: c.id,
          name: c.name,
          gamesCount: cGames.length,
          isHomeGroup: false,
          ref: c,
          previewGames: cGames.slice(0, 3).map(getBestImage),
        };
      }),
      ...homeGroups.map((g) => {
        const gGames = library.filter((game) =>
          g.gameIds.includes(game.objectId)
        );
        return {
          id: g.id,
          name: g.name,
          gamesCount: gGames.length,
          isHomeGroup: true,
          ref: g,
          previewGames: gGames.slice(0, 3).map(getBestImage),
        };
      }),
    ];
  }, [collections, homeGroups, library]);

  const hasGames = library.length > 0;
  const hasNoFilteredGames = sortedLibrary.length === 0;
  const isFavoritesCollectionSelected =
    selectedCollectionId === FAVORITES_COLLECTION_ID;
  const shouldShowFavoritesEmptyState =
    hasGames && isFavoritesCollectionSelected && hasNoFilteredGames;
  const shouldShowCollectionEmptyState =
    hasGames &&
    !shouldShowFavoritesEmptyState &&
    Boolean(selectedCollectionId) &&
    !isFavoritesCollectionSelected &&
    hasNoFilteredGames;

  return (
    <section className="library library__page">
      {hasGames && (
        <>
          <div
            className="library__filter-bar"
            data-gamepad-autofocus-skip="true"
          >
            <div className="library__controls-row">
              <div
                className="library__controls-left"
                style={{ flex: 1, minWidth: 200, maxWidth: "100%" }}
              >
                <div
                  className="header__search-bar header__search-bar--inline"
                  style={{
                    width: "100%",
                    padding: "8px 16px",
                    minWidth: "unset",
                  }}
                >
                  <SearchIcon size={16} className="header__search-bar-icon" />
                  <input
                    type="text"
                    className="header__search-input"
                    placeholder={t("search_library", {
                      ns: "header",
                      defaultValue: "Buscar na biblioteca...",
                    })}
                    value={searchQuery}
                    onChange={(e) =>
                      dispatch(setLibrarySearchQuery(e.target.value))
                    }
                  />
                </div>
              </div>
              <div className="library__controls-right">
                <PlatformFilter
                  platform={platformTab}
                  onPlatformChange={setPlatformTab}
                />
                <FilterOptions
                  sortBy={sortBy}
                  onSortChange={handleSortChange}
                />
                <button
                  type="button"
                  className="library__favorites-btn"
                  onClick={() => setShowAddCustomGameModal(true)}
                  title={t("add_custom_game", {
                    defaultValue: "Adicionar jogo personalizado",
                  })}
                  aria-label="Adicionar jogo personalizado"
                >
                  <PlusIcon size={16} />
                </button>
                <button
                  type="button"
                  className={`library__favorites-btn ${
                    isFavoritesCollectionSelected
                      ? "library__favorites-btn--active"
                      : ""
                  }`}
                  onClick={() =>
                    handleCollectionSelect(
                      isFavoritesCollectionSelected
                        ? null
                        : FAVORITES_COLLECTION_ID
                    )
                  }
                  title={t("favorites")}
                  aria-pressed={isFavoritesCollectionSelected}
                >
                  <HeartIcon size={16} />
                </button>
                <ViewOptions
                  viewMode={viewMode}
                  onViewModeChange={handleViewModeChange}
                />
              </div>
            </div>
          </div>
        </>
      )}

      <div className="library__content">
        {hasGames && !selectedCollectionId && (
          <div
            style={{
              display: "flex",
              flexDirection: "column",
              gap: "16px",
              marginBottom: "16px",
            }}
          >
            <div style={{ display: "flex" }}>
              <Button
                theme="outline"
                onClick={() => {
                  const params = new URLSearchParams(searchParams);
                  params.set("collection", "new");
                  setSearchParams(params);
                }}
              >
                <PlusIcon size={16} />
                {t("create_folder", { defaultValue: "Criar pasta" })}
              </Button>
            </div>

            {libraryCollections.length > 0 && (
              <div
                className="library__folders-grid"
                style={{ marginBottom: 0 }}
              >
                {libraryCollections.map((collection) => (
                  <button
                    key={collection.id}
                    type="button"
                    className={`library__folder-card ${
                      selectedCollectionId === collection.id
                        ? "library__folder-card--active"
                        : ""
                    }`}
                    onClick={() =>
                      handleCollectionSelect(
                        selectedCollectionId === collection.id
                          ? null
                          : collection.id
                      )
                    }
                    onContextMenu={(event) => {
                      if (collection.isHomeGroup) return;
                      handleOpenCollectionContextMenu(
                        event,
                        collection.ref as GameCollection
                      );
                    }}
                  >
                    <div className="library__folder-card-previews">
                      <div className="library__folder-preview-container">
                        {collection.previewGames.length > 0 ? (
                          collection.previewGames.map((url, i) => (
                            <img
                              key={i}
                              src={url || ""}
                              alt="preview"
                              className="library__folder-preview-img"
                            />
                          ))
                        ) : (
                          <div className="library__folder-preview-empty">
                            <FileDirectoryIcon size={24} />
                          </div>
                        )}
                      </div>
                    </div>
                    <div className="library__folder-card-info">
                      <span
                        className="library__folder-card-name"
                        title={collection.name}
                      >
                        {collection.name}
                      </span>
                      <div className="library__folder-card-meta">
                        <span className="library__folder-card-meta-item">
                          <FileDirectoryIcon size={12} />
                          {collection.gamesCount} jogo
                          {collection.gamesCount !== 1 ? "s" : ""}
                        </span>
                      </div>
                    </div>
                  </button>
                ))}
              </div>
            )}
          </div>
        )}

        {hasGames && selectedCollectionId && (
          <div className="library__folder-back-nav">
            {showFolderPicker ? (
              // ── Picker mode bar ──────────────────────────────────
              <>
                <button
                  type="button"
                  className="library__select-all-btn"
                  onClick={handleFolderPickerCancel}
                >
                  <XIcon size={14} />
                  Cancelar
                </button>

                <div
                  style={{
                    display: "flex",
                    alignItems: "center",
                    marginLeft: 8,
                  }}
                >
                  <span
                    style={{
                      fontSize: 13,
                      color: "rgba(255,255,255,0.5)",
                      marginRight: 8,
                    }}
                  >
                    Adicionar jogos em
                  </span>
                  <input
                    className="library__folder-back-input"
                    value={folderPickerName}
                    onChange={(e) => setFolderPickerName(e.target.value)}
                    placeholder="Nome da pasta"
                    // eslint-disable-next-line jsx-a11y/no-autofocus
                    autoFocus
                  />
                </div>

                <div
                  style={{
                    marginLeft: "auto",
                    display: "flex",
                    gap: "8px",
                    alignItems: "center",
                  }}
                >
                  <span
                    style={{ fontSize: 12, color: "rgba(255,255,255,0.4)" }}
                  >
                    {folderPickerSelectedIds.size} selecionado
                    {folderPickerSelectedIds.size !== 1 ? "s" : ""}
                  </span>
                  <Button theme="primary" onClick={handleFolderPickerConfirm}>
                    <CheckIcon size={14} />
                    Salvar
                  </Button>
                </div>
              </>
            ) : (
              // ── Normal folder bar ─────────────────────────────────
              <>
                <Button
                  theme="outline"
                  onClick={() => handleCollectionSelect(null)}
                  className="library__folder-back-button"
                >
                  <ChevronLeftIcon size={16} />
                  {t("back", { defaultValue: "Voltar", ns: "shared" })}
                </Button>
                <div className="library__folder-back-info">
                  <FileDirectoryIcon size={24} />
                  <h2 style={{ margin: 0 }}>
                    {selectedCollectionId === FAVORITES_COLLECTION_ID
                      ? t("favorites")
                      : libraryCollections.find(
                          (c) => c.id === selectedCollectionId
                        )?.name}
                  </h2>
                </div>

                {homeGroups.some((g) => g.id === selectedCollectionId) &&
                  (() => {
                    const currentHomeGroup = homeGroups.find(
                      (g) => g.id === selectedCollectionId
                    );
                    const folderGameIds = currentHomeGroup?.gameIds ?? [];
                    const allSelected =
                      folderGameIds.length > 0 &&
                      folderGameIds.every((id) => selectedGameIds.has(id));
                    const someSelected = selectedGameIds.size > 0;

                    return (
                      <div
                        style={{
                          marginLeft: "auto",
                          display: "flex",
                          gap: "8px",
                          alignItems: "center",
                        }}
                      >
                        {someSelected && (
                          <Button
                            theme="danger"
                            onClick={handleRemoveSelectedFromFolder}
                          >
                            <TrashIcon size={14} />
                            Remover selecionados ({selectedGameIds.size})
                          </Button>
                        )}

                        <button
                          type="button"
                          className={`library__select-all-btn${allSelected ? " library__select-all-btn--active" : ""}`}
                          onClick={() => handleSelectAll(folderGameIds)}
                          title={
                            allSelected ? "Desmarcar todos" : "Selecionar todos"
                          }
                        >
                          <span className="library__select-all-checkbox">
                            {allSelected && <span>✓</span>}
                          </span>
                          {allSelected ? "Desmarcar todos" : "Selecionar todos"}
                        </button>

                        <Button
                          theme="outline"
                          onClick={handleOpenFolderPicker}
                        >
                          <PlusIcon size={16} />
                          Adicionar jogos
                        </Button>
                        <Button
                          theme="danger"
                          onClick={() => {
                            deleteGroup(selectedCollectionId!);
                            handleCollectionSelect(null);
                          }}
                        >
                          <TrashIcon size={16} />
                          Excluir pasta
                        </Button>
                      </div>
                    );
                  })()}
              </>
            )}
          </div>
        )}

        {!hasGames && (
          <div className="library__no-games">
            <div className="library__telescope-icon">
              <TelescopeIcon size={24} />
            </div>
            <h2>{t("no_games_title")}</h2>
            <p>{t("no_games_description")}</p>
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
            <h2>{t("empty_collection_title")}</h2>
            <p>{t("empty_collection_description")}</p>
          </div>
        )}

        {hasGames &&
          !shouldShowFavoritesEmptyState &&
          !shouldShowCollectionEmptyState && (
            <AnimatePresence mode="wait">
              {viewMode === "compact" && (
                <motion.div
                  key={`${sortBy}-catalogue`}
                  initial={{ opacity: 0, x: -10 }}
                  animate={{ opacity: 1, x: 0 }}
                  exit={{ opacity: 0, x: 10 }}
                  transition={{ duration: 0.2 }}
                >
                  <LibraryCatalogueView
                    games={sortedLibrary}
                    onContextMenu={
                      !showFolderPicker ? handleOpenContextMenu : undefined
                    }
                    onToggleFavorite={
                      !showFolderPicker ? handleToggleFavorite : undefined
                    }
                    onRemoveFromLibrary={
                      !showFolderPicker ? setGameToRemove : undefined
                    }
                    onRemoveFromFolder={
                      !showFolderPicker &&
                      homeGroups.some((g) => g.id === selectedCollectionId)
                        ? handleRemoveFromFolder
                        : undefined
                    }
                    selectedGameIds={
                      showFolderPicker
                        ? folderPickerSelectedIds
                        : homeGroups.some((g) => g.id === selectedCollectionId)
                          ? selectedGameIds
                          : undefined
                    }
                    onToggleSelect={
                      showFolderPicker
                        ? handleFolderPickerToggle
                        : homeGroups.some((g) => g.id === selectedCollectionId)
                          ? handleToggleSelectGame
                          : undefined
                    }
                    selectOnClick={showFolderPicker}
                  />
                </motion.div>
              )}

              {viewMode === "grid" && (
                <motion.ul
                  key={`${sortBy}-grid`}
                  className="library__games-grid library__games-grid--grid"
                  initial={{ opacity: 0, x: -10 }}
                  animate={{ opacity: 1, x: 0 }}
                  exit={{ opacity: 0, x: 10 }}
                  transition={{ duration: 0.2 }}
                >
                  {sortedLibrary.map((game) => (
                    <li
                      key={`${game.shop}-${game.objectId}`}
                      style={{ listStyle: "none" }}
                    >
                      <LibraryGameCard
                        game={game}
                        onMouseEnter={
                          !showFolderPicker
                            ? handleOnMouseEnterGameCard
                            : undefined
                        }
                        onMouseLeave={
                          !showFolderPicker
                            ? handleOnMouseLeaveGameCard
                            : undefined
                        }
                        onContextMenu={
                          !showFolderPicker ? handleOpenContextMenu : undefined
                        }
                        onToggleFavorite={
                          !showFolderPicker ? handleToggleFavorite : undefined
                        }
                        onRemoveFromLibrary={
                          !showFolderPicker ? setGameToRemove : undefined
                        }
                        onRemoveFromFolder={
                          !showFolderPicker &&
                          homeGroups.some((g) => g.id === selectedCollectionId)
                            ? handleRemoveFromFolder
                            : undefined
                        }
                        isSelected={
                          showFolderPicker
                            ? folderPickerSelectedIds.has(String(game.objectId))
                            : selectedGameIds.has(game.objectId)
                        }
                        onToggleSelect={
                          showFolderPicker
                            ? handleFolderPickerToggle
                            : homeGroups.some(
                                  (g) => g.id === selectedCollectionId
                                )
                              ? handleToggleSelectGame
                              : undefined
                        }
                        selectOnClick={showFolderPicker}
                      />
                    </li>
                  ))}
                </motion.ul>
              )}
            </AnimatePresence>
          )}

        {gameContextMenu.game && (
          <GameContextMenu
            game={gameContextMenu.game}
            visible={gameContextMenu.visible}
            position={gameContextMenu.position}
            onClose={handleCloseContextMenu}
          />
        )}

        <ContextMenu
          items={collectionContextMenuItems}
          visible={collectionContextMenu.visible}
          position={collectionContextMenu.position}
          onClose={handleCloseCollectionContextMenu}
        />

        {gameToRemove && (
          <ConfirmationModal
            visible={!!gameToRemove}
            title={t("remove_from_library_title", {
              ns: "game_details",
              defaultValue: "Remover da biblioteca",
            })}
            descriptionText={t("remove_from_library_description", {
              ns: "game_details",
              defaultValue: `Tem certeza que deseja remover {{game}} da biblioteca?`,
              game: gameToRemove.title,
            })}
            onClose={() => setGameToRemove(null)}
            onConfirm={() => handleRemoveFromLibrary(gameToRemove)}
            cancelButtonLabel={t("cancel", { ns: "sidebar" })}
            confirmButtonLabel={t("remove", {
              ns: "game_details",
              defaultValue: "Remover",
            })}
            buttonsIsDisabled={isRemovingGame}
          />
        )}

        <Modal
          visible={showRenameCollectionModal}
          title={t("rename_collection")}
          description={t("rename_collection_description")}
          onClose={handleCloseRenameCollectionModal}
        >
          <div className="library__collection-modal">
            <TextField
              label={t("collection_name", { ns: "sidebar" })}
              placeholder={t("collection_name_placeholder", { ns: "sidebar" })}
              value={collectionName}
              onChange={(event) => setCollectionName(event.target.value)}
              theme="dark"
              disabled={isRenamingCollection}
              maxLength={60}
            />

            <div className="library__collection-modal-actions">
              <Button
                type="button"
                theme="outline"
                onClick={handleCloseRenameCollectionModal}
                disabled={isRenamingCollection}
              >
                {t("cancel", { ns: "sidebar" })}
              </Button>

              <Button
                type="button"
                theme="primary"
                onClick={handleRenameCollection}
                disabled={!collectionName.trim() || isRenamingCollection}
              >
                {isRenamingCollection
                  ? t("renaming_collection")
                  : t("rename_collection")}
              </Button>
            </div>
          </div>
        </Modal>

        <ConfirmationModal
          visible={showDeleteCollectionModal}
          title={t("delete_collection_title")}
          descriptionText={t("delete_collection_description", {
            collectionName: activeCollection?.name ?? "",
          })}
          onClose={handleCloseDeleteCollectionModal}
          onConfirm={() => {
            void handleDeleteCollection();
          }}
          cancelButtonLabel={t("cancel", { ns: "sidebar" })}
          confirmButtonLabel={t("delete_collection")}
          buttonsIsDisabled={isDeletingCollection}
        />
      </div>

      <AddCustomGameModal
        visible={showAddCustomGameModal}
        onClose={() => setShowAddCustomGameModal(false)}
      />
    </section>
  );
}
