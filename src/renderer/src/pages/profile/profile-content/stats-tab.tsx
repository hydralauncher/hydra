import { useCallback, useContext, useMemo, useState } from "react";
import { motion } from "framer-motion";
import { userProfileContext } from "@renderer/context";
import { useTranslation } from "react-i18next";
import { useFormat, useUserDetails } from "@renderer/hooks";
import { MAX_MINUTES_TO_SHOW_IN_PLAYTIME } from "@renderer/constants";
import { Link } from "@renderer/components";
import { buildGameDetailsPath } from "@renderer/helpers";
import {
  ClockIcon,
  TrophyIcon,
  PackageIcon,
  GraphIcon,
  SearchIcon,
  ImageIcon,
} from "@primer/octicons-react";
import { Award } from "lucide-react";
import HydraIcon from "@renderer/assets/icons/hydra.svg?react";
import type { UserGame } from "@types";
import { WrappedFullscreenModal } from "./wrapped-tab";
import "./stats-tab.scss";

const MAX_MOST_PLAYED = 10;

export function StatsTab() {
  const [showWrappedModal, setShowWrappedModal] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const { userStats, isMe, userProfile, libraryGames, pinnedGames } =
    useContext(userProfileContext);
  const { userDetails } = useUserDetails();
  const { t } = useTranslation("user_profile");
  const { numberFormatter } = useFormat();

  const formatPlayTime = useCallback(
    (playTimeInSeconds: number) => {
      const minutes = playTimeInSeconds / 60;

      if (minutes < MAX_MINUTES_TO_SHOW_IN_PLAYTIME) {
        return t("amount_minutes", { amount: minutes.toFixed(0) });
      }

      const hours = minutes / 60;
      return t("amount_hours", { amount: numberFormatter.format(hours) });
    },
    [numberFormatter, t]
  );

  const formatPlayTimeShort = useCallback(
    (game: UserGame) => {
      const seconds = game.playTimeInSeconds || 0;
      const minutes = seconds / 60;

      if (minutes < MAX_MINUTES_TO_SHOW_IN_PLAYTIME) {
        return t("amount_minutes_short", { amount: minutes.toFixed(0) });
      }

      const hours = minutes / 60;
      return t("amount_hours_short", {
        amount: numberFormatter.format(hours),
      });
    },
    [numberFormatter, t]
  );

  const allGames = useMemo(() => {
    const merged = [...pinnedGames, ...libraryGames];
    return merged.filter(
      (g, i, self) => self.findIndex((x) => x.objectId === g.objectId) === i
    );
  }, [pinnedGames, libraryGames]);

  const computedStats = useMemo(() => {
    const gamesWithAchievements = allGames.filter(
      (g) =>
        g.achievementCount !== undefined &&
        g.achievementCount > 0 &&
        g.unlockedAchievementCount !== undefined &&
        g.unlockedAchievementCount > 0
    );

    const totalUnlocked = gamesWithAchievements.reduce(
      (sum, g) => sum + (g.unlockedAchievementCount || 0),
      0
    );
    const totalAchievements = gamesWithAchievements.reduce(
      (sum, g) => sum + (g.achievementCount || 0),
      0
    );

    const completionRate =
      totalAchievements > 0
        ? Math.round((totalUnlocked / totalAchievements) * 100)
        : null;

    const totalPlaytime = userStats?.totalPlayTimeInSeconds.value || 0;
    const libraryCount = userStats?.libraryCount || allGames.length;
    const avgPlaytime =
      libraryCount > 0 ? Math.floor(totalPlaytime / libraryCount) : 0;

    return {
      libraryCount,
      avgPlaytime,
      completionRate,
      gamesWithAchievements: gamesWithAchievements.length,
      totalUnlocked,
    };
  }, [allGames, userStats]);

  const topGames = useMemo(() => {
    const played = allGames
      .filter((game) => game.playTimeInSeconds > 0)
      .sort((a, b) => b.playTimeInSeconds - a.playTimeInSeconds)
      .slice(0, MAX_MOST_PLAYED);

    if (!searchQuery.trim()) return played;

    const queryLower = searchQuery.toLowerCase();
    return played.filter((game) => {
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
  }, [allGames, searchQuery]);

  const notPlayedGames = useMemo(() => {
    const games = allGames.filter(
      (game) => !game.playTimeInSeconds || game.playTimeInSeconds === 0
    );

    if (!searchQuery.trim()) return games;

    const queryLower = searchQuery.toLowerCase();
    return games.filter((game) => {
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
  }, [allGames, searchQuery]);

  if (!userStats) return null;

  const karma = isMe ? userDetails?.karma : userProfile?.karma;
  const hasKarma = karma !== undefined && karma !== null;
  const maxPlayTime = topGames.length > 0 ? topGames[0].playTimeInSeconds : 0;

  return (
    <motion.div
      key="stats"
      className="stats-tab"
      initial={{ opacity: 0, x: -10 }}
      animate={{ opacity: 1, x: 0 }}
      exit={{ opacity: 0, x: 10 }}
      transition={{ duration: 0.2 }}
    >
      {/* Overview cards */}
      <div className="stats-tab__overview">
        <div className="stats-tab__card">
          <PackageIcon size={18} />
          <span className="stats-tab__card-value">
            {numberFormatter.format(computedStats.libraryCount)}
          </span>
          <span className="stats-tab__card-label">{t("library_size")}</span>
        </div>

        <div className="stats-tab__card">
          <ClockIcon size={18} />
          <span className="stats-tab__card-value">
            {formatPlayTime(userStats.totalPlayTimeInSeconds.value)}
          </span>
          <span className="stats-tab__card-label">{t("total_play_time")}</span>
          <span
            className="stats-tab__card-rank"
            title={t("ranking_updated_weekly")}
          >
            {t("top_percentile", {
              percentile: userStats.totalPlayTimeInSeconds.topPercentile,
            })}
          </span>
        </div>

        <div className="stats-tab__card">
          <ClockIcon size={18} />
          <span className="stats-tab__card-value">
            {formatPlayTime(computedStats.avgPlaytime)}
          </span>
          <span className="stats-tab__card-label">{t("avg_playtime")}</span>
        </div>

        {computedStats.completionRate !== null && (
          <div className="stats-tab__card">
            <GraphIcon size={18} />
            <span className="stats-tab__card-value">
              {t("completion_rate_value", {
                rate: computedStats.completionRate,
              })}
            </span>
            <span className="stats-tab__card-label">
              {t("completion_rate")}
            </span>
          </div>
        )}

        {(userStats.unlockedAchievementSum !== undefined ||
          computedStats.totalUnlocked > 0) && (
          <div className="stats-tab__card">
            <TrophyIcon size={18} />
            <span className="stats-tab__card-value">
              {userStats.unlockedAchievementSum ?? computedStats.totalUnlocked}
            </span>
            <span className="stats-tab__card-label">
              {t("achievements_unlocked")}
            </span>
          </div>
        )}

        {userStats.achievementsPointsEarnedSum !== undefined && (
          <div className="stats-tab__card">
            <HydraIcon width={18} height={18} />
            <span className="stats-tab__card-value">
              {numberFormatter.format(
                userStats.achievementsPointsEarnedSum.value
              )}
            </span>
            <span className="stats-tab__card-label">{t("earned_points")}</span>
            <span
              className="stats-tab__card-rank"
              title={t("ranking_updated_weekly")}
            >
              {t("top_percentile", {
                percentile: userStats.achievementsPointsEarnedSum.topPercentile,
              })}
            </span>
          </div>
        )}

        {hasKarma && karma !== undefined && karma !== null && (
          <div className="stats-tab__card">
            <Award size={18} />
            <span className="stats-tab__card-value">
              {numberFormatter.format(karma)}
            </span>
            <span className="stats-tab__card-label">{t("karma")}</span>
          </div>
        )}
      </div>

      {/* Wrapped badge */}
      {userProfile?.hasCompletedWrapped2025 && (
        <button
          type="button"
          onClick={() => setShowWrappedModal(true)}
          className="stats-tab__wrapped-button"
        >
          Wrapped 2025
        </button>
      )}

      {/* Search input */}
      {(topGames.length > 0 || notPlayedGames.length > 0) && (
        <div className="stats-tab__search">
          <SearchIcon size={14} className="stats-tab__search-icon" />
          <input
            type="text"
            className="stats-tab__search-input"
            placeholder={t("search_stats")}
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
          />
        </div>
      )}

      {/* Most Played leaderboard */}
      {topGames.length > 0 && (
        <div className="stats-tab__section">
          <h3 className="stats-tab__section-title">{t("most_played")}</h3>
          <ol className="stats-tab__leaderboard">
            {topGames.map((game, index) => {
              const barWidth = (game.playTimeInSeconds / maxPlayTime) * 100;

              return (
                <li key={game.objectId} className="stats-tab__leaderboard-item">
                  <Link
                    to={buildGameDetailsPath(game)}
                    className="stats-tab__leaderboard-link"
                  >
                    <span className="stats-tab__leaderboard-rank">
                      {index + 1}
                    </span>

                    {game.iconUrl && (
                      <img
                        className="stats-tab__leaderboard-icon"
                        src={game.iconUrl}
                        alt={game.title}
                      />
                    )}

                    <div className="stats-tab__leaderboard-details">
                      <span className="stats-tab__leaderboard-title">
                        {game.title}
                      </span>
                      <div className="stats-tab__leaderboard-bar-container">
                        <div
                          className="stats-tab__leaderboard-bar"
                          style={{ width: `${barWidth}%` }}
                        />
                      </div>
                    </div>

                    <span className="stats-tab__leaderboard-time">
                      {formatPlayTimeShort(game)}
                    </span>
                  </Link>
                </li>
              );
            })}
          </ol>
        </div>
      )}

      {/* Not yet played section */}
      {notPlayedGames.length > 0 && (
        <div className="stats-tab__section">
          <h3 className="stats-tab__section-title">
            {t("not_yet_played_section")}
          </h3>
          <div className="stats-tab__not-played-list">
            {notPlayedGames.map((game) => (
              <Link
                key={game.objectId}
                to={buildGameDetailsPath(game)}
                className="stats-tab__not-played-item"
              >
                {game.iconUrl ? (
                  <img
                    className="stats-tab__not-played-icon"
                    src={game.iconUrl}
                    alt={game.title}
                  />
                ) : (
                  <div className="stats-tab__not-played-icon-placeholder">
                    <ImageIcon size={14} />
                  </div>
                )}
                <span className="stats-tab__not-played-title">
                  {game.title}
                </span>
                <span className="stats-tab__not-played-badge">
                  {t("not_played_yet")}
                </span>
              </Link>
            ))}
          </div>
        </div>
      )}

      {userProfile && (
        <WrappedFullscreenModal
          userId={userProfile.id}
          isOpen={showWrappedModal}
          onClose={() => setShowWrappedModal(false)}
        />
      )}
    </motion.div>
  );
}
