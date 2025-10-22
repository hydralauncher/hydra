import { useEffect, useMemo, useState } from "react";
import { useLibrary, useAppDispatch } from "@renderer/hooks";
import { setHeaderTitle } from "@renderer/features";
import { TelescopeIcon } from "@primer/octicons-react";
import { useTranslation } from "react-i18next";
import { LibraryGameCard } from "./library-game-card";
// detailed view removed — keep file if needed later
import { LibraryGameCardLarge } from "./library-game-card-large";
import { ViewOptions, ViewMode } from "./view-options";
import { FilterOptions, FilterOption } from "./filter-options";
import { SearchBar } from "./search-bar";
import "./library.scss";

export default function Library() {
  const { library, updateLibrary } = useLibrary();

  const [viewMode, setViewMode] = useState<ViewMode>("grid");
  const [filterBy, setFilterBy] = useState<FilterOption>("all");
  const [searchQuery, setSearchQuery] = useState<string>("");
  const dispatch = useAppDispatch();
  const { t } = useTranslation("library");

  useEffect(() => {
    dispatch(setHeaderTitle(t("library")));

    // Refresh library assets from cloud, then update library display
    window.electron
      .refreshLibraryAssets()
      .then(() => updateLibrary())
      .catch(() => updateLibrary()); // Fallback to local cache on error

    // Listen for library sync completion to refresh cover images
    const unsubscribe = window.electron.onLibraryBatchComplete(() => {
      updateLibrary();
    });

    return () => {
      unsubscribe();
    };
  }, [dispatch, t, updateLibrary]);

  const handleOnMouseEnterGameCard = () => {
    // Optional: pause animations if needed
  };

  const handleOnMouseLeaveGameCard = () => {
    // Optional: resume animations if needed
  };

  // Simple fuzzy search function
  const fuzzySearch = (query: string, items: typeof library) => {
    if (!query.trim()) return items;

    const queryLower = query.toLowerCase();
    return items.filter((game) => {
      const titleLower = game.title.toLowerCase();
      let matches = 0;
      let queryIndex = 0;

      for (
        let i = 0;
        i < titleLower.length && queryIndex < queryLower.length;
        i++
      ) {
        if (titleLower[i] === queryLower[queryIndex]) {
          matches++;
          queryIndex++;
        }
      }

      return queryIndex === queryLower.length;
    });
  };

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

    // Apply search filter
    return fuzzySearch(searchQuery, filtered);
  }, [library, filterBy, searchQuery]);

  // No sorting for now — rely on filteredLibrary
  const sortedLibrary = filteredLibrary;

  // Calculate counts for filters
  const allGamesCount = library.length;
  const favouritedCount = library.filter((game) => game.favorite).length;
  const newGamesCount = library.filter(
    (game) => (game.playTimeInMilliseconds || 0) === 0
  ).length;
  const top10Count = Math.min(10, library.length);

  const hasGames = library.length > 0;

  return (
    <section className="library__content">
      {hasGames && (
        <>
          <div className="library__page-header">
            <div className="library__controls-row">
              <div className="library__controls-left">
                <FilterOptions
                  filterBy={filterBy}
                  onFilterChange={setFilterBy}
                  allGamesCount={allGamesCount}
                  favouritedCount={favouritedCount}
                  newGamesCount={newGamesCount}
                  top10Count={top10Count}
                />
              </div>

              <div className="library__controls-right">
                <SearchBar value={searchQuery} onChange={setSearchQuery} />
                <ViewOptions
                  viewMode={viewMode}
                  onViewModeChange={setViewMode}
                />
              </div>
            </div>
          </div>
        </>
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
              />
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
