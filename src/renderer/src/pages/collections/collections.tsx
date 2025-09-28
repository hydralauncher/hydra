import { useEffect, useState, useMemo, useCallback } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { useCollections, useLibrary } from "@renderer/hooks";
import {
  FileDirectoryIcon,
  SearchIcon,
  GearIcon,
} from "@primer/octicons-react";
import { CreateCollectionButton } from "@renderer/components/sidebar/create-collection-button";
import { CollectionInfoModal } from "@renderer/components/sidebar/collection-info-modal";
import { GameCard } from "@renderer/components";
import type { Collection, LibraryGame } from "@types";
import "./collections.scss";

export default function Collections() {
  const navigate = useNavigate();
  const { collectionId } = useParams();
  const { t } = useTranslation("collections");
  const { collections, getCollections } = useCollections();
  const { library } = useLibrary();
  const [selectedCollection, setSelectedCollection] =
    useState<Collection | null>(null);
  const [searchTerm, setSearchTerm] = useState("");
  const [sortBy, setSortBy] = useState<"name" | "year" | "shop">("name");
  const [collectionSearchTerm, setCollectionSearchTerm] = useState("");
  const [collectionSortBy, setCollectionSortBy] = useState<
    "name" | "createdAt" | "gameCount"
  >("name");
  const [showCollectionInfoModal, setShowCollectionInfoModal] = useState(false);
  const [selectedCollectionForInfo, setSelectedCollectionForInfo] =
    useState<Collection | null>(null);

  useEffect(() => {
    getCollections();
  }, [getCollections]);

  useEffect(() => {
    if (collectionId) {
      const collection = collections.find((c) => c.id === collectionId);
      setSelectedCollection(collection || null);
    } else {
      setSelectedCollection(null);
    }
  }, [collectionId, collections]);

  const getCollectionGames = useCallback(
    (collection: Collection): LibraryGame[] => {
      return collection.gameIds
        .map((gameId) => {
          // Parse gameId to find the game
          const [shop, objectId] = gameId.split(":");
          return library.find(
            (game) => game.shop === shop && game.objectId === objectId
          );
        })
        .filter((game): game is LibraryGame => game !== undefined);
    },
    [library]
  );

  const filteredAndSortedGames = useMemo(() => {
    if (!selectedCollection) return [];

    let games = [...getCollectionGames(selectedCollection)]; // Create a copy to avoid readonly error

    // Filter by search term
    if (searchTerm) {
      games = games.filter(
        (game) =>
          game.title.toLowerCase().includes(searchTerm.toLowerCase()) ||
          game.shop.toLowerCase().includes(searchTerm.toLowerCase())
      );
    }

    // Sort games
    games.sort((a, b) => {
      switch (sortBy) {
        case "name":
          return a.title.localeCompare(b.title);
        case "year":
          // Sort by title since releaseDate is not available in LibraryGame
          return a.title.localeCompare(b.title);
        case "shop":
          return a.shop.localeCompare(b.shop);
        default:
          return 0;
      }
    });

    return games;
  }, [selectedCollection, searchTerm, sortBy, getCollectionGames]);

  const filteredAndSortedCollections = useMemo(() => {
    let filteredCollections = [...collections]; // Create a copy to avoid readonly error

    // Filter by search term
    if (collectionSearchTerm) {
      filteredCollections = filteredCollections.filter((collection) =>
        collection.name
          .toLowerCase()
          .includes(collectionSearchTerm.toLowerCase())
      );
    }

    // Sort collections
    filteredCollections.sort((a, b) => {
      switch (collectionSortBy) {
        case "name":
          return a.name.localeCompare(b.name);
        case "createdAt":
          return (
            new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
          ); // Newest first
        case "gameCount":
          return b.gameIds.length - a.gameIds.length; // Most games first
        default:
          return 0;
      }
    });

    return filteredCollections;
  }, [collections, collectionSearchTerm, collectionSortBy]);

  const handleCollectionClick = (collection: Collection) => {
    navigate(`/collections/${collection.id}`);
  };

  const handleCollectionConfigClick = (
    e: React.MouseEvent,
    collection: Collection
  ) => {
    e.stopPropagation(); // Prevent card click
    setSelectedCollectionForInfo(collection);
    setShowCollectionInfoModal(true);
  };

  const handleCloseCollectionInfoModal = () => {
    setShowCollectionInfoModal(false);
    setSelectedCollectionForInfo(null);
  };

  // Back button removed - using native browser back

  // Delete functionality moved to right-click context menu

  const handleGameClick = (game: LibraryGame) => {
    navigate(`/game/${game.shop}/${game.objectId}`);
  };

  if (selectedCollection) {
    // Visualização de uma coleção específica
    const collectionGames = getCollectionGames(selectedCollection);

    return (
      <div className="collections-page">
        <div className="collections-header">
          <h1 className="collections-title">
            📂 {t("collection_title", { name: selectedCollection.name })}
            <span className="collections-count">
              {t("collection_count", { count: collectionGames.length })}
            </span>
          </h1>
        </div>

        <div className="collections-filters">
          <div className="collections-search">
            <SearchIcon size={16} />
            <input
              type="text"
              placeholder={t("search_games_placeholder")}
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="collections-search-input"
            />
          </div>

          <div className="collections-sort">
            <label htmlFor="sort-select">{t("sort_by")}</label>
            <select
              id="sort-select"
              value={sortBy}
              onChange={(e) =>
                setSortBy(e.target.value as "name" | "year" | "shop")
              }
              className="collections-sort-select"
            >
              <option value="name">{t("sort_name")}</option>
              <option value="year">{t("sort_title")}</option>
              <option value="shop">{t("sort_shop")}</option>
            </select>
          </div>
        </div>

        <section className="collections-games-grid">
          {filteredAndSortedGames.length === 0 ? (
            <div className="collections-empty">
              <FileDirectoryIcon size={48} />
              <h3>
                {searchTerm
                  ? t("no_games_found")
                  : t("no_games_in_collection")}
              </h3>
              <p>
                {searchTerm
                  ? t("no_games_search_hint")
                  : t("no_games_add_hint")}
              </p>
            </div>
          ) : (
            filteredAndSortedGames.map((game) => (
              <GameCard
                key={game.id}
                game={game}
                onClick={() => handleGameClick(game)}
              />
            ))
          )}
        </section>
      </div>
    );
  }

  // Visualização geral das coleções
  return (
    <div className="collections-page collections-page--main">
      <section className="collections-content">
        <div className="collections-header">
          <h1 className="collections-title">📁 {t("title")}</h1>
          <p className="collections-subtitle">
            {t("subtitle")}
          </p>
        </div>

        <div className="collections-filters">
          <div className="collections-search">
            <SearchIcon size={16} />
            <input
              type="text"
              placeholder={t("search_collections_placeholder")}
              value={collectionSearchTerm}
              onChange={(e) => setCollectionSearchTerm(e.target.value)}
              className="collections-search-input"
            />
          </div>

          <div className="collections-sort">
            <label htmlFor="collection-sort-select">{t("sort_by")}</label>
            <select
              id="collection-sort-select"
              value={collectionSortBy}
              onChange={(e) =>
                setCollectionSortBy(
                  e.target.value as "name" | "createdAt" | "gameCount"
                )
              }
              className="collections-sort-select"
            >
              <option value="name">{t("sort_name")}</option>
              <option value="createdAt">{t("sort_created_at")}</option>
              <option value="gameCount">{t("sort_game_count")}</option>
            </select>
          </div>
        </div>

        <div className="collections-create-section">
          <CreateCollectionButton />
        </div>

        <section className="collections-grid">
          {filteredAndSortedCollections.length === 0 ? (
            <div className="collections-empty">
              <FileDirectoryIcon size={48} />
              <h3>
                {collectionSearchTerm
                  ? t("no_collections_found")
                  : t("no_collections_created")}
              </h3>
              <p>
                {collectionSearchTerm
                  ? t("no_collections_search_hint")
                  : t("no_collections_create_hint")}
              </p>
            </div>
          ) : (
            filteredAndSortedCollections.map((collection) => {
              const gameCount = getCollectionGames(collection).length;
              const collectionGames = getCollectionGames(collection);
              const previewGames = collectionGames.slice(0, 5); // Mostrar até 5 jogos como preview

              return (
                <div
                  key={collection.id}
                  className="collections-card"
                  onClick={() => handleCollectionClick(collection)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" || e.key === " ") {
                      e.preventDefault();
                      handleCollectionClick(collection);
                    }
                  }}
                  role="button"
                  tabIndex={0}
                >
                  <button
                    className="collections-card-config-button"
                    onClick={(e) => handleCollectionConfigClick(e, collection)}
                    title={t("collection_settings")}
                  >
                    <GearIcon size={16} />
                  </button>

                  <div className="collections-card-backdrop">
                    {previewGames.length > 0 &&
                      previewGames[0].libraryImageUrl ? (
                      <img
                        src={previewGames[0].libraryImageUrl}
                        alt={collection.name}
                        className="collections-card-cover"
                        loading="lazy"
                      />
                    ) : (
                      <div className="collections-card-cover-placeholder">
                        <FileDirectoryIcon size={48} />
                      </div>
                    )}

                    <div className="collections-card-content">
                      <div className="collections-card-title-container">
                        <FileDirectoryIcon size={20} />
                        <h3 className="collections-card-title">
                          {collection.name}
                        </h3>
                      </div>

                      <p className="collections-card-count">
                        {t("games_count", { count: gameCount })}
                      </p>

                      {previewGames.length > 1 && (
                        <div className="collections-card-preview">
                          {previewGames.slice(1, 5).map((game) => (
                            <div
                              key={game.id}
                              className="collections-card-preview-item"
                            >
                              {game.iconUrl ? (
                                <img
                                  src={game.iconUrl}
                                  alt={game.title}
                                  className="collections-card-preview-icon"
                                />
                              ) : (
                                <div className="collections-card-preview-icon-placeholder">
                                  <FileDirectoryIcon size={12} />
                                </div>
                              )}
                            </div>
                          ))}
                          {gameCount > 5 && (
                            <div className="collections-card-preview-more">
                              +{gameCount - 5}
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              );
            })
          )}
        </section>
      </section>

      <CollectionInfoModal
        collection={selectedCollectionForInfo}
        isOpen={showCollectionInfoModal}
        onClose={handleCloseCollectionInfoModal}
      />
    </div>
  );
}
