import { useEffect, useMemo, useState, useCallback } from "react";
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
    setContextMenu({ game: null, visible: false, position: { x: 0, y: 0 } });
  }, []);

  const filteredLibrary = useMemo(() => {
    let filtered;

    switch (filterBy) {
      case "favourited":
        filtered = library.filter((game) => game.favorite);
        break;
      case "new":
        filtered = library.filter(
          (game) => (game.playTimeInMilliseconds || 0) === 0
        );
        break;
      case "top10":
        filtered = library
          .slice()
          .sort(
            (a, b) =>
              (b.playTimeInMilliseconds || 0) - (a.playTimeInMilliseconds || 0)
          )
          .slice(0, 10);
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
    let favouritedCount = 0;
    let newGamesCount = 0;

    for (const game of library) {
      if (game.favorite) favouritedCount++;
      if ((game.playTimeInMilliseconds || 0) === 0) newGamesCount++;
    }

    return {
      allGamesCount,
      favouritedCount,
      newGamesCount,
      top10Count: Math.min(10, allGamesCount),
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
                favouritedCount={filterCounts.favouritedCount}
                newGamesCount={filterCounts.newGamesCount}
                top10Count={filterCounts.top10Count}
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

      {hasGames && viewMode === "large" && (
        <div className="library__games-list library__games-list--large">
          {sortedLibrary.map((game) => (
            <LibraryGameCardLarge
              key={`${game.shop}-${game.objectId}`}
              game={game}
              onContextMenu={handleOpenContextMenu}
            />
          ))}
        </div>
      )}

      {hasGames && viewMode !== "large" && (
        <ul className={`library__games-grid library__games-grid--${viewMode}`}>
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
        </ul>
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
