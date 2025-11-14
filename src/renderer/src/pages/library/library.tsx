import { useEffect, useMemo, useState, useCallback } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { useLibrary, useAppDispatch, useAppSelector } from "@renderer/hooks";
import { setHeaderTitle } from "@renderer/features";
import { TelescopeIcon, PlayIcon, XIcon } from "@primer/octicons-react";
import { useTranslation } from "react-i18next";
import { LibraryGame } from "@types";
import { GameContextMenu, SelectField } from "@renderer/components";
import { LibraryGameCard } from "./library-game-card";
import { LibraryGameCardLarge } from "./library-game-card-large";
import { ViewOptions, ViewMode } from "./view-options";
import { FilterOptions, FilterOption } from "./filter-options";
import "./library.scss";

export default function Library() {
  const { library, updateLibrary } = useLibrary();

  const [viewMode, setViewMode] = useState<ViewMode>(() => {
    const savedViewMode = localStorage.getItem("library-view-mode");
    return (savedViewMode as ViewMode) || "compact";
  });
  const [filterBy, setFilterBy] = useState<FilterOption>("all");
  const [sortOption, setSortOption] = useState<
    "default" | "time_played" | "achievements" | "achievement_percentage" | "last_played"
  >(() => {
    const saved = localStorage.getItem("library-sort");
    if (saved === "last_added") {
      localStorage.setItem("library-sort", "last_played");
      return "last_played";
    }
    return (saved as any) || "default";
  });
  const [onlyWithExe, setOnlyWithExe] = useState<boolean>(() => !!localStorage.getItem("library-only-with-exe"));
  const [onlyCustoms, setOnlyCustoms] = useState<boolean>(() => !!localStorage.getItem("library-only-customs"));
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
    dispatch(setHeaderTitle(t("library")));

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

  const getPlaytime = (g: LibraryGame) =>
    (g.playTimeInMilliseconds ?? 0) / 1000; // Convert milliseconds to seconds
  const getAchievements = (g: LibraryGame) =>
    (g.unlockedAchievementCount ?? g.achievementCount ?? 0) as number;
  const getAchievementPercentage = (g: LibraryGame) => {
    const total = g.achievementCount ?? 0;
    if (total === 0) return 0;
    const unlocked = g.unlockedAchievementCount ?? 0;
    return unlocked / total;
  };
  const hasExe = (g: LibraryGame) =>
    !!(g.executablePath);
  const isCustom = (g: LibraryGame) => g.shop === "custom";
  const orderedLibrary = useMemo(() => {
    let list = [...filteredLibrary];
    if (onlyWithExe) list = list.filter((g) => hasExe(g));
    if (onlyCustoms) list = list.filter((g) => isCustom(g));
    if (filterBy === "recently_played") {
      list.sort((a, b) => {
        const ta = a.lastTimePlayed ? new Date(a.lastTimePlayed).getTime() : 0;
        const tb = b.lastTimePlayed ? new Date(b.lastTimePlayed).getTime() : 0;
        return tb - ta;
      });
      return list;
    }

    switch (sortOption) {
      case "time_played":
        list.sort((a, b) => getPlaytime(b) - getPlaytime(a));
        break;
      case "achievements":
        list.sort((a, b) => getAchievements(b) - getAchievements(a));
        break;
      case "achievement_percentage":
        list.sort((a, b) => getAchievementPercentage(b) - getAchievementPercentage(a));
        break;
      case "last_played":
        list.sort((a, b) => {
          const ta = a.lastTimePlayed ? new Date(a.lastTimePlayed).getTime() : 0;
          const tb = b.lastTimePlayed ? new Date(b.lastTimePlayed).getTime() : 0;
          return tb - ta;
        });
        break;
      case "default":
      default:
        break;
    }

    return list;
  }, [filteredLibrary, sortOption, onlyWithExe, onlyCustoms, filterBy]);

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
                onFilterChange={(newFilter) => {
                  setFilterBy(newFilter);
                  if (newFilter === "recently_played") {
                    setSortOption("last_played");
                    localStorage.setItem("library-sort", "last_played");
                  }
                }}
                allGamesCount={filterCounts.allGamesCount}
                recentlyPlayedCount={filterCounts.recentlyPlayedCount}
                favoritesCount={filterCounts.favoritesCount}
              />
            </div>

            <div className="library__controls-right">
              <ViewOptions
                viewMode={viewMode}
                onViewModeChange={handleViewModeChange}
              />
              <div className="library__sort-controls" style={{ display: "inline-flex", gap: 8, marginLeft: 8, alignItems: "center" }}>
                <SelectField
                  theme="dark"
                  value={sortOption}
                  onChange={(e) => {
                    const v = e.target.value as any;
                    setSortOption(v);
                    localStorage.setItem("library-sort", v);
                  }}
                  options={[
                    { key: "default", value: "default", label: t("sort.default") },
                    { key: "last_played", value: "last_played", label: t("sort.last_played") },
                    { key: "time_played", value: "time_played", label: t("sort.time_played") },
                    { key: "achievements", value: "achievements", label: t("sort.achievements") },
                    { key: "achievement_percentage", value: "achievement_percentage", label: t("sort.achievement_percentage") },
                  ]}
                />
                <button
                  type="button"
                  onClick={() => {
                    const newValue = !onlyWithExe;
                    setOnlyWithExe(newValue);
                    if (newValue) localStorage.setItem("library-only-with-exe", "1");
                    else localStorage.removeItem("library-only-with-exe");
                  }}
                  style={{
                    background: "none",
                    border: "none",
                    color: onlyWithExe ? "#16b195" : "rgba(255, 255, 255, 0.6)",
                    cursor: "pointer",
                    padding: "2px",
                    display: "inline-flex",
                    alignItems: "center",
                    justifyContent: "center",
                    transition: "color ease 0.2s",
                  }}
                  title={t("filters.only_with_exe")}
                >
                  <PlayIcon size={16} />
                </button>
                <button
                  type="button"
                  onClick={() => {
                    const newValue = !onlyCustoms;
                    setOnlyCustoms(newValue);
                    if (newValue) localStorage.setItem("library-only-customs", "1");
                    else localStorage.removeItem("library-only-customs");
                  }}
                  style={{
                    background: "none",
                    border: "none",
                    color: onlyCustoms ? "#16b195" : "rgba(255, 255, 255, 0.6)",
                    cursor: "pointer",
                    padding: "4px",
                    display: "inline-flex",
                    alignItems: "center",
                    justifyContent: "center",
                    transition: "color ease 0.2s",
                  }}
                  title={t("filters.only_customs")}
                >
                  <XIcon size={16} />
                </button>
              </div>
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
              {orderedLibrary.map((game) => (
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
              {orderedLibrary.map((game) => (
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
