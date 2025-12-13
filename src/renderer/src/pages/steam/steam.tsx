import { useEffect, useMemo, useState, useCallback } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { useLibrary, useAppDispatch, useAppSelector } from "@renderer/hooks";
import { setHeaderTitle } from "@renderer/features";
import { TelescopeIcon } from "@primer/octicons-react";
import { useTranslation } from "react-i18next";
import { LibraryGame } from "@types";
import { GameContextMenu } from "@renderer/components";
import { LibraryGameCard } from "../library/library-game-card";
import { LibraryGameCardLarge } from "../library/library-game-card-large";
import { ViewOptions, ViewMode } from "../library/view-options";
import { FilterOptions, FilterOption } from "../library/filter-options";
import "./steam.scss";

export default function Steam() {
  const { library, updateLibrary } = useLibrary();

  const [viewMode, setViewMode] = useState<ViewMode>(() => {
    const savedViewMode = localStorage.getItem("library-view-mode");
    return (savedViewMode as ViewMode) || "compact";
  });
  const [filterBy, setFilterBy] = useState<FilterOption>("all");
  const [contextMenu, setContextMenu] = useState<{
    game: LibraryGame | null;
    visible: boolean;
    position: { x: number; y: number };
  }>({ game: null, visible: false, position: { x: 0, y: 0 } });

  const searchQuery = useAppSelector((state) => state.library.searchQuery);
  const dispatch = useAppDispatch();
  const { t } = useTranslation("library");

  const handleViewModeChange = useCallback((mode: ViewMode) => {
    setViewMode(mode);
    localStorage.setItem("library-view-mode", mode);
  }, []);

  useEffect(() => {
    dispatch(setHeaderTitle("Steam"));

    const unsubscribe = window.electron.onLibraryBatchComplete(() => {
      updateLibrary();
    });

    window.electron
      .refreshLibraryAssets()
      .then(() => updateLibrary())
      .catch(() => updateLibrary());

    return () => {
      unsubscribe();
    };
  }, [dispatch, updateLibrary]);

  const handleOnMouseEnterGameCard = useCallback(() => {
    // Optional: pause animations if needed
  }, []);

  const handleOnMouseLeaveGameCard = useCallback(() => {
    // Optional: resume animations if needed
  }, []);

  const handleOpenContextMenu = useCallback(
    (game: LibraryGame, position: { x: number; y: number }) => {
      setContextMenu({ game, visible: true, position });
    },
    []
  );

  const handleCloseContextMenu = useCallback(() => {
    setContextMenu((prev) => ({ ...prev, visible: false }));
  }, []);

  // Filtrar apenas jogos Steam importados
  const steamLibrary = useMemo(() => {
    return library.filter(
      (game) => game.shop === "steam" && game.isImported === true && !game.isDeleted
    );
  }, [library]);

  const filteredLibrary = useMemo(() => {
    let filtered;

    switch (filterBy) {
      case "recently_played":
        filtered = steamLibrary
          .filter((game) => game.lastTimePlayed !== null)
          .sort(
            (a: any, b: any) =>
              new Date(b.lastTimePlayed).getTime() -
              new Date(a.lastTimePlayed).getTime()
          );
        break;
      case "favorites":
        filtered = steamLibrary.filter((game) => game.favorite);
        break;
      case "all":
      default:
        filtered = steamLibrary;
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
  }, [steamLibrary, filterBy, searchQuery]);

  const sortedLibrary = filteredLibrary;

  const filterCounts = useMemo(() => {
    const allGamesCount = steamLibrary.length;
    let recentlyPlayedCount = 0;
    let favoritesCount = 0;

    for (const game of steamLibrary) {
      if (game.lastTimePlayed !== null) recentlyPlayedCount++;
      if (game.favorite) favoritesCount++;
    }

    return {
      allGamesCount,
      recentlyPlayedCount,
      favoritesCount,
    };
  }, [steamLibrary]);

  const hasGames = steamLibrary.length > 0;

  return (
    <section className="steam__content">
      {hasGames && (
        <div className="steam__page-header">
          <div className="steam__controls-row">
            <div className="steam__controls-left">
              <FilterOptions
                filterBy={filterBy}
                onFilterChange={setFilterBy}
                allGamesCount={filterCounts.allGamesCount}
                recentlyPlayedCount={filterCounts.recentlyPlayedCount}
                favoritesCount={filterCounts.favoritesCount}
              />
            </div>

            <div className="steam__controls-right">
              <ViewOptions
                viewMode={viewMode}
                onViewModeChange={handleViewModeChange}
              />
            </div>
          </div>
        </div>
      )}

      {!hasGames && (
        <div className="steam__no-games">
          <div className="steam__telescope-icon">
            <TelescopeIcon size={24} />
          </div>
          <h2>{t("no_games_title")}</h2>
          <p>{t("no_games_description")}</p>
        </div>
      )}

      {hasGames && (
        <AnimatePresence mode="wait">
          {viewMode === "large" && (
            <motion.div
              key={`${filterBy}-large`}
              className="steam__games-list steam__games-list--large"
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
              key={`${filterBy}-${viewMode}`}
              className={`steam__games-grid steam__games-grid--${viewMode}`}
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

      {contextMenu.game && (
        <GameContextMenu
          game={contextMenu.game}
          visible={contextMenu.visible}
          position={contextMenu.position}
          onClose={handleCloseContextMenu}
        />
      )}
    </section>
  );
}

