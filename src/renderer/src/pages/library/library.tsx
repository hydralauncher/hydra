import { useEffect, useMemo, useState, useCallback } from "react";
import { AnimatePresence, motion } from "framer-motion";
import {
  useLibrary,
  useAppDispatch,
  useAppSelector,
  useGameCollections,
  useToast,
} from "@renderer/hooks";
import { setHeaderTitle } from "@renderer/features";
import {
  HeartIcon,
  TelescopeIcon,
  FileDirectoryIcon,
  PencilIcon,
  TrashIcon,
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
import { LibraryGameCard } from "./library-game-card";
import { LibraryGameCardLarge } from "./library-game-card-large";
import { ViewOptions, ViewMode } from "./view-options";
import { FilterOptions, SortOption } from "./filter-options";
import "./library.scss";

const FAVORITES_COLLECTION_ID = "__favorites__";
const SORT_OPTIONS: SortOption[] = [
  "title_asc",
  "recently_played",
  "most_played",
  "installed_first",
  "title_desc",
];

export default function Library() {
  const { library, updateLibrary } = useLibrary();
  const { showSuccessToast, showErrorToast } = useToast();
  const {
    collections,
    loadCollections,
    hasLoaded: hasLoadedCollections,
  } = useGameCollections();
  const [searchParams, setSearchParams] = useSearchParams();

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

  const searchQuery = useAppSelector((state) => state.library.searchQuery);
  const dispatch = useAppDispatch();
  const { t } = useTranslation(["library", "sidebar"]);

  const selectedCollectionId = searchParams.get("collection");

  const handleCollectionSelect = useCallback(
    (collectionId: string | null) => {
      const params = new URLSearchParams(searchParams);

      if (collectionId) {
        params.set("collection", collectionId);
      } else {
        params.delete("collection");
      }

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

    const hasCollection = collections.some(
      (collection) => collection.id === selectedCollectionId
    );

    if (!hasCollection) {
      handleCollectionSelect(null);
    }
  }, [
    collections,
    selectedCollectionId,
    handleCollectionSelect,
    hasLoadedCollections,
  ]);

  const filteredLibrary = useMemo(() => {
    let filtered = library;

    if (selectedCollectionId) {
      if (selectedCollectionId === FAVORITES_COLLECTION_ID) {
        filtered = filtered.filter((game) => game.favorite);
      } else {
        filtered = filtered.filter(
          (game) => game.collectionId === selectedCollectionId
        );
      }
    }

    if (!searchQuery.trim()) return filtered;

    const queryLower = searchQuery.toLowerCase();
    return filtered.filter((game) => {
      const titleLower = game.title.toLowerCase();
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
  }, [library, searchQuery, selectedCollectionId]);

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

  const favoritesCount = useMemo(() => {
    return library.filter((game) => game.favorite).length;
  }, [library]);

  const libraryCollections = useMemo<GameCollection[]>(() => {
    return [
      {
        id: FAVORITES_COLLECTION_ID,
        name: t("favorites"),
        gamesCount: favoritesCount,
      },
      ...collections,
    ];
  }, [collections, favoritesCount, t]);

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
    <section className="library__content">
      {hasGames && (
        <div className="library__page-header">
          <div className="library__controls-row">
            <div className="library__controls-left">
              <FilterOptions sortBy={sortBy} onSortChange={handleSortChange} />
            </div>

            <div className="library__controls-right">
              <ViewOptions
                viewMode={viewMode}
                onViewModeChange={handleViewModeChange}
              />
            </div>
          </div>

          <div
            className="library__collections"
            role="group"
            aria-label={t("collections")}
          >
            {libraryCollections.map((collection) => {
              const isFavoritesCollection =
                collection.id === FAVORITES_COLLECTION_ID;

              return (
                <button
                  key={collection.id}
                  type="button"
                  className={`library__collection-item ${selectedCollectionId === collection.id ? "library__collection-item--active" : ""}`}
                  onClick={() =>
                    handleCollectionSelect(
                      selectedCollectionId === collection.id
                        ? null
                        : collection.id
                    )
                  }
                  onContextMenu={
                    isFavoritesCollection
                      ? undefined
                      : (event) =>
                          handleOpenCollectionContextMenu(event, collection)
                  }
                >
                  {isFavoritesCollection ? (
                    <HeartIcon size={16} />
                  ) : (
                    <FileDirectoryIcon size={16} />
                  )}
                  <span>{collection.name}</span>
                  <span className="library__collection-count">
                    {collection.gamesCount}
                  </span>
                </button>
              );
            })}
          </div>
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
            {viewMode === "large" && (
              <motion.div
                key={`${sortBy}-large`}
                className="library__games-list library__games-list--large"
                initial={{ opacity: 0, x: -10 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: 10 }}
                transition={{ duration: 0.2 }}
              >
                {sortedLibrary.map((game) => (
                  <LibraryGameCardLarge
                    key={`${game.shop}-${game.objectId}`}
                    game={game}
                    onContextMenu={handleOpenContextMenu}
                  />
                ))}
              </motion.div>
            )}

            {viewMode !== "large" && (
              <motion.ul
                key={`${sortBy}-${viewMode}`}
                className={`library__games-grid library__games-grid--${viewMode}`}
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
                      onMouseEnter={handleOnMouseEnterGameCard}
                      onMouseLeave={handleOnMouseLeaveGameCard}
                      onContextMenu={handleOpenContextMenu}
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
    </section>
  );
}
