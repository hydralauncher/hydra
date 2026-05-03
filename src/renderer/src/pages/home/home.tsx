import { useCallback, useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import cn from "classnames";
import { levelDBService } from "@renderer/services/leveldb.service";
import { orderBy } from "lodash-es";
import { useNavigate } from "react-router-dom";

import Skeleton, { SkeletonTheme } from "react-loading-skeleton";

import {
  Button,
  GameCard,
  Hero,
  PlayHeatmap,
  StreakBadge,
} from "@renderer/components";
import { getDisplayStreak } from "@shared";
import type {
  DownloadSource,
  LibraryGame,
  ShopAssets,
  Steam250Game,
  UserStats,
} from "@types";

import { ActivityFeed } from "./activity-feed";

import flameIconStatic from "@renderer/assets/icons/flame-static.png";
import flameIconAnimated from "@renderer/assets/icons/flame-animated.gif";
import starsIconAnimated from "@renderer/assets/icons/stars-animated.gif";

import { buildGameDetailsPath } from "@renderer/helpers";
import { CatalogueCategory } from "@shared";
import { useUserDetails } from "@renderer/hooks";
import { useLibrary } from "@renderer/hooks";
import "./home.scss";

export default function Home() {
  const { t } = useTranslation("home");
  const navigate = useNavigate();
  const { userDetails } = useUserDetails();
  const { library } = useLibrary();

  const [animateFlame, setAnimateFlame] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [randomGame, setRandomGame] = useState<Steam250Game | null>(null);
  const [userStats, setUserStats] = useState<UserStats | null>(null);

  const [currentCatalogueCategory, setCurrentCatalogueCategory] = useState(
    CatalogueCategory.Hot
  );

  const [catalogue, setCatalogue] = useState<
    Record<CatalogueCategory, ShopAssets[]>
  >({
    [CatalogueCategory.Hot]: [],
    [CatalogueCategory.Weekly]: [],
    [CatalogueCategory.Achievements]: [],
  });

  const recentGames = useMemo(() => {
    if (!library || library.length === 0) return [];
    return orderBy(
      library.filter((game) => game.lastTimePlayed),
      ["lastTimePlayed"],
      ["desc"]
    ).slice(0, 10);
  }, [library]);

  const streakGames = useMemo(() => {
    if (!library || library.length === 0) return [];
    const today = new Date();
    return library
      .map((game) => ({
        game,
        display: getDisplayStreak(
          {
            currentStreak: game.currentStreak ?? 0,
            longestStreak: game.longestStreak ?? 0,
            lastStreakDate: game.lastStreakDate ?? null,
          },
          today
        ),
      }))
      .filter((entry) => entry.display >= 2)
      .sort((a, b) => b.display - a.display)
      .slice(0, 6);
  }, [library]);

  const hasPlayHistory = useMemo(
    () => library?.some((game) => game.playedDates?.length),
    [library]
  );

  const longestStreakEver = useMemo(() => {
    if (!library || library.length === 0) return 0;
    return library.reduce(
      (max, game) => Math.max(max, game.longestStreak ?? 0),
      0
    );
  }, [library]);

  const formatPlayTime = (ms: number) => {
    const hours = Math.floor(ms / 3600000);
    if (hours < 1) {
      const minutes = Math.floor(ms / 60000);
      return `${minutes}m`;
    }
    return t("hours_played", { hours });
  };

  const getCatalogue = useCallback(async (category: CatalogueCategory) => {
    try {
      setCurrentCatalogueCategory(category);
      setIsLoading(true);

      const sources = (await levelDBService.values(
        "downloadSources"
      )) as DownloadSource[];
      const downloadSources = orderBy(sources, "createdAt", "desc");

      const params = {
        take: 12,
        skip: 0,
        downloadSourceIds: downloadSources.map((source) => source.id),
      };

      const catalogue = await window.electron.hydraApi.get<ShopAssets[]>(
        `/catalogue/${category}`,
        {
          params,
          needsAuth: false,
        }
      );

      setCatalogue((prev) => ({ ...prev, [category]: catalogue }));
    } finally {
      setIsLoading(false);
    }
  }, []);

  const getRandomGame = useCallback(() => {
    window.electron.getRandomGame().then((game) => {
      if (game) setRandomGame(game);
    });
  }, []);

  const handleRandomizerClick = () => {
    if (randomGame) {
      navigate(
        buildGameDetailsPath(
          { ...randomGame, shop: "steam" },
          {
            fromRandomizer: "1",
          }
        )
      );
    }
  };

  const handleCategoryClick = (category: CatalogueCategory) => {
    if (category !== currentCatalogueCategory) {
      getCatalogue(category);
    }
  };

  useEffect(() => {
    setIsLoading(true);
    getCatalogue(CatalogueCategory.Hot);
    getRandomGame();
  }, [getCatalogue, getRandomGame]);

  useEffect(() => {
    if (userDetails) {
      window.electron.hydraApi
        .get<UserStats>(`/users/${userDetails.id}/stats`)
        .then((data) => {
          setUserStats(data);
        })
        .catch(() => {});
    }
  }, [userDetails]);

  const categories = Object.values(CatalogueCategory);

  const handleMouseEnterCategory = (category: CatalogueCategory) => {
    if (category === CatalogueCategory.Hot) {
      setAnimateFlame(true);
    }
  };

  const handleMouseLeaveCategory = (category: CatalogueCategory) => {
    if (category === CatalogueCategory.Hot) {
      setAnimateFlame(false);
    }
  };

  const formatTotalPlayTime = (seconds: number) => {
    const hours = Math.floor(seconds / 3600);
    return `${hours}h`;
  };

  const handleRecentGameClick = (game: LibraryGame) => {
    navigate(
      buildGameDetailsPath({
        objectId: game.objectId,
        shop: game.shop,
        title: game.title,
      })
    );
  };

  return (
    <SkeletonTheme baseColor="#1c1c1c" highlightColor="#444">
      <section className="home__content">
        <Hero />

        {/* Streaks */}
        {streakGames.length > 0 && (
          <section className="home__section home__streaks">
            <div className="home__streaks-header">
              <div className="home__streaks-title-wrapper">
                <div className="home__streaks-flame-wrapper">
                  <img
                    src={flameIconAnimated}
                    alt=""
                    className="home__streaks-flame"
                  />
                  <span className="home__streaks-flame-glow" />
                </div>
                <h2 className="home__section-title home__streaks-title">
                  {t("your_streaks")}
                </h2>
              </div>

              {longestStreakEver >= 2 && (
                <div className="home__streaks-record">
                  <span className="home__streaks-record-label">
                    {t("best_streak_ever")}
                  </span>
                  <span className="home__streaks-record-value">
                    {t("days_count", { count: longestStreakEver })}
                  </span>
                </div>
              )}
            </div>

            <div className="home__horizontal-scroll">
              {streakGames.map(({ game, display }, index) => (
                <button
                  key={game.id}
                  className={cn("home__streak-card", {
                    "home__streak-card--featured": index === 0,
                  })}
                  onClick={() => handleRecentGameClick(game)}
                >
                  <div className="home__streak-card-flame">
                    <img
                      src={flameIconAnimated}
                      alt=""
                      className="home__streak-card-flame-icon"
                    />
                    <span className="home__streak-card-flame-pulse" />
                  </div>

                  <div className="home__streak-card-count">
                    <span className="home__streak-card-number">{display}</span>
                    <span className="home__streak-card-unit">
                      {t("days_label", { count: display })}
                    </span>
                  </div>

                  <div className="home__streak-card-game">
                    {game.iconUrl && (
                      <img
                        src={game.iconUrl}
                        alt={game.title}
                        className="home__streak-card-game-icon"
                      />
                    )}
                    <span className="home__streak-card-game-title">
                      {game.title}
                    </span>
                  </div>
                </button>
              ))}
            </div>
          </section>
        )}

        {/* Play heatmap */}
        {hasPlayHistory && (
          <section className="home__section home__heatmap-section">
            <h2 className="home__section-title">{t("play_activity")}</h2>
            <PlayHeatmap library={library} />
          </section>
        )}

        {/* Continue Playing */}
        {recentGames.length > 0 && (
          <section className="home__section">
            <h2 className="home__section-title">{t("continue_playing")}</h2>
            <div className="home__horizontal-scroll">
              {recentGames.map((game) => (
                <button
                  key={game.id}
                  className="home__recent-game-card"
                  onClick={() => handleRecentGameClick(game)}
                >
                  <div className="home__recent-game-image">
                    {game.iconUrl ? (
                      <img
                        src={game.iconUrl}
                        alt={game.title}
                        className="home__recent-game-icon"
                      />
                    ) : (
                      <div className="home__recent-game-placeholder" />
                    )}
                  </div>
                  <div className="home__recent-game-info">
                    <span className="home__recent-game-title">
                      {game.title}
                    </span>
                    <span className="home__recent-game-playtime">
                      {formatPlayTime(game.playTimeInMilliseconds)}
                    </span>
                    <StreakBadge
                      currentStreak={game.currentStreak}
                      longestStreak={game.longestStreak}
                      lastStreakDate={game.lastStreakDate}
                      variant="compact"
                    />
                  </div>
                </button>
              ))}
            </div>
          </section>
        )}

        {/* Activity Feed + Stats row */}
        {userDetails && (
          <section className="home__social-row">
            <ActivityFeed userDetails={userDetails} />

            <div className="home__stats-panel">
              <h3 className="home__panel-title">{t("your_stats")}</h3>
              <div className="home__stats-grid">
                <div className="home__stat-item">
                  <span className="home__stat-value">
                    {userStats?.libraryCount ?? library.length}
                  </span>
                  <span className="home__stat-label">{t("total_games")}</span>
                </div>
                <div className="home__stat-item">
                  <span className="home__stat-value">
                    {userStats
                      ? formatTotalPlayTime(
                          userStats.totalPlayTimeInSeconds.value
                        )
                      : "0h"}
                  </span>
                  <span className="home__stat-label">
                    {t("total_playtime")}
                  </span>
                </div>
                {userStats?.unlockedAchievementSum != null && (
                  <div className="home__stat-item">
                    <span className="home__stat-value">
                      {userStats.unlockedAchievementSum}
                    </span>
                    <span className="home__stat-label">
                      {t("achievements_unlocked")}
                    </span>
                  </div>
                )}
              </div>
            </div>
          </section>
        )}

        {/* Catalogue Categories */}
        <section className="home__header">
          <ul className="home__buttons-list">
            {categories.map((category) => (
              <li key={category}>
                <Button
                  theme={
                    category === currentCatalogueCategory
                      ? "primary"
                      : "outline"
                  }
                  onClick={() => handleCategoryClick(category)}
                  onMouseEnter={() => handleMouseEnterCategory(category)}
                  onMouseLeave={() => handleMouseLeaveCategory(category)}
                >
                  {category === CatalogueCategory.Hot && (
                    <div className="home__icon-wrapper">
                      <img
                        src={flameIconStatic}
                        alt="Flame icon"
                        className="home__flame-icon"
                        style={{ display: animateFlame ? "none" : "block" }}
                      />
                      <img
                        src={flameIconAnimated}
                        alt="Flame animation"
                        className="home__flame-icon"
                        style={{ display: animateFlame ? "block" : "none" }}
                      />
                    </div>
                  )}

                  {t(category)}
                </Button>
              </li>
            ))}
          </ul>

          <Button
            onClick={handleRandomizerClick}
            theme="outline"
            disabled={!randomGame}
          >
            <div className="home__icon-wrapper">
              <img
                src={starsIconAnimated}
                alt="Stars animation"
                className="home__stars-icon"
              />
            </div>
            {t("surprise_me")}
          </Button>
        </section>

        <h2 className="home__title">
          {currentCatalogueCategory === CatalogueCategory.Hot && (
            <div className="home__title-icon">
              <img
                src={flameIconAnimated}
                alt="Flame animation"
                className="home__title-flame-icon"
              />
            </div>
          )}

          {t(currentCatalogueCategory)}
        </h2>

        <section className="home__cards">
          {isLoading
            ? Array.from({ length: 12 }).map((_, index) => (
                <Skeleton key={index} className="home__card-skeleton" />
              ))
            : catalogue[currentCatalogueCategory].map((result) => (
                <GameCard
                  key={result.objectId}
                  game={result}
                  onClick={() => navigate(buildGameDetailsPath(result))}
                />
              ))}
        </section>
      </section>
    </SkeletonTheme>
  );
}
