import { useEffect, useMemo, useState, useCallback } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { useLibrary, useAppDispatch, useAppSelector } from "@renderer/hooks";
import { setHeaderTitle } from "@renderer/features";
import { TelescopeIcon } from "@primer/octicons-react";
import { useTranslation } from "react-i18next";
import { LibraryGame } from "@types";
import { GameContextMenu } from "@renderer/components";
import { LibraryGameCard } from "./library-game-card";
import { LibraryGameCardLarge } from "./library-game-card-large";
import { ViewOptions, ViewMode } from "./view-options";
import { FilterOptions, FilterOption } from "./filter-options";
import "./library.scss";

export default function Library() {
  const { library, updateLibrary } = useLibrary();
  type ElectronAPI = {
    refreshLibraryAssets?: () => Promise<unknown>;
    onLibraryBatchComplete?: (cb: () => void) => () => void;
  };

  const [viewMode, setViewMode] = useState<ViewMode>("compact");
  const [filterBy, setFilterBy] = useState<FilterOption>("all");
  const [contextMenu, setContextMenu] = useState<{
    game: LibraryGame | null;
    visible: boolean;
    position: { x: number; y: number };
  }>({ game: null, visible: false, position: { x: 0, y: 0 } });

  const searchQuery = useAppSelector((state) => state.library.searchQuery);
  const dispatch = useAppDispatch();
  const { t } = useTranslation("library");

  useEffect(() => {
    dispatch(setHeaderTitle(t("library")));
    const electron = (globalThis as unknown as { electron?: ElectronAPI })
      .electron;
    let unsubscribe: () => void = () => undefined;
    if (electron?.refreshLibraryAssets) {
      electron
        .refreshLibraryAssets()
        .then(() => updateLibrary())
        .catch(() => updateLibrary());
      if (electron.onLibraryBatchComplete) {
        unsubscribe = electron.onLibraryBatchComplete(() => {
          updateLibrary();
        });
      }
    } else {
      updateLibrary();
    }

    return () => {
      unsubscribe();
    };
  }, [dispatch, t, updateLibrary]);

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

  const filteredLibrary = useMemo(() => {
    let filtered;

    switch (filterBy) {
      case "recently_played":
        filtered = library.filter((game) => game.lastTimePlayed !== null);
        break;
      case "favorites":
        filtered = library.filter((game) => game.favorite);
        break;
      case "all":
      default:
        filtered = library;
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
  }, [library, filterBy, searchQuery]);

  const sortedLibrary = filteredLibrary;

  const filterCounts = useMemo(() => {
    const allGamesCount = library.length;
    let recentlyPlayedCount = 0;
    let favoritesCount = 0;

    for (const game of library) {
      if (game.lastTimePlayed !== null) recentlyPlayedCount++;
      if (game.favorite) favoritesCount++;
    }

    return {
      allGamesCount,
      recentlyPlayedCount,
      favoritesCount,
    };
  }, [library]);

  const hasGames = library.length > 0;

  return (
    <section className="library__content">
      {hasGames && (
        <div className="library__page-header">
          <div className="library__controls-row">
            <div className="library__controls-left">
              <FilterOptions
                filterBy={filterBy}
                onFilterChange={setFilterBy}
                allGamesCount={filterCounts.allGamesCount}
                recentlyPlayedCount={filterCounts.recentlyPlayedCount}
                favoritesCount={filterCounts.favoritesCount}
              />
            </div>

            <div className="library__controls-right">
              <ViewOptions viewMode={viewMode} onViewModeChange={setViewMode} />
            </div>
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

      {hasGames && (
        <AnimatePresence mode="wait">
          {viewMode === "large" && (
            <motion.div
              key={`${filterBy}-large`}
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
              key={`${filterBy}-${viewMode}`}
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
