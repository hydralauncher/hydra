import { useCallback, useContext, useMemo, useState } from "react";
import { userProfileContext } from "@renderer/context";
import { useTranslation } from "react-i18next";
import { useFormat, useUserDetails } from "@renderer/hooks";
import { MAX_MINUTES_TO_SHOW_IN_PLAYTIME } from "@renderer/constants";
import HydraIcon from "@renderer/assets/icons/hydra.svg?react";
import {
  ClockIcon,
  TrophyIcon,
  PackageIcon,
  GraphIcon,
} from "@primer/octicons-react";
import { Award } from "lucide-react";
import { WrappedFullscreenModal } from "./wrapped-tab";
import "./user-stats-box.scss";

export function UserStatsBox() {
  const [showWrappedModal, setShowWrappedModal] = useState(false);
  const { userStats, isMe, userProfile, libraryGames, pinnedGames } =
    useContext(userProfileContext);
  const { userDetails } = useUserDetails();
  const { t } = useTranslation("user_profile");
  const { numberFormatter } = useFormat();

  const formatPlayTime = useCallback(
    (playTimeInSeconds: number) => {
      const seconds = playTimeInSeconds;
      const minutes = seconds / 60;

      if (minutes < MAX_MINUTES_TO_SHOW_IN_PLAYTIME) {
        return t("amount_minutes", {
          amount: minutes.toFixed(0),
        });
      }

      const hours = minutes / 60;
      return t("amount_hours", { amount: numberFormatter.format(hours) });
    },
    [numberFormatter, t]
  );

  const computedStats = useMemo(() => {
    const allGames = [...pinnedGames, ...libraryGames];
    const unique = allGames.filter(
      (g, i, self) => self.findIndex((x) => x.objectId === g.objectId) === i
    );

    const gamesWithAchievements = unique.filter(
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
    const libraryCount = userStats?.libraryCount || unique.length;
    const avgPlaytime =
      libraryCount > 0 ? Math.floor(totalPlaytime / libraryCount) : 0;

    return {
      libraryCount,
      avgPlaytime,
      completionRate,
      gamesWithAchievements: gamesWithAchievements.length,
      totalUnlocked,
    };
  }, [libraryGames, pinnedGames, userStats]);

  if (!userStats) return null;

  const karma = isMe ? userDetails?.karma : userProfile?.karma;
  const hasKarma = karma !== undefined && karma !== null;

  return (
    <div className="user-stats__box">
      <div className="user-stats__overview">
        <div className="user-stats__overview-item">
          <PackageIcon size={14} />
          <span className="user-stats__overview-value">
            {numberFormatter.format(computedStats.libraryCount)}
          </span>
          <span className="user-stats__overview-label">
            {t("library_size")}
          </span>
        </div>

        <div className="user-stats__overview-item">
          <ClockIcon size={14} />
          <span className="user-stats__overview-value">
            {formatPlayTime(computedStats.avgPlaytime)}
          </span>
          <span className="user-stats__overview-label">
            {t("avg_playtime")}
          </span>
        </div>

        {computedStats.completionRate !== null && (
          <div className="user-stats__overview-item">
            <GraphIcon size={14} />
            <span className="user-stats__overview-value">
              {t("completion_rate_value", {
                rate: computedStats.completionRate,
              })}
            </span>
            <span className="user-stats__overview-label">
              {t("completion_rate")}
            </span>
          </div>
        )}
      </div>

      <ul className="user-stats__list">
        {userProfile?.hasCompletedWrapped2025 && (
          <li className="user-stats__list-item user-stats__list-item--wrapped">
            <button
              type="button"
              onClick={() => setShowWrappedModal(true)}
              className="user-stats__wrapped-link"
            >
              Wrapped 2025
            </button>
          </li>
        )}

        {(userStats.unlockedAchievementSum !== undefined ||
          computedStats.totalUnlocked > 0) && (
          <li className="user-stats__list-item">
            <h3 className="user-stats__list-title">
              {t("achievements_unlocked")}
            </h3>
            <div className="user-stats__stats-row">
              <p className="user-stats__list-description">
                <TrophyIcon />{" "}
                {userStats.unlockedAchievementSum ??
                  computedStats.totalUnlocked}{" "}
                {t("achievements")}
              </p>
            </div>
          </li>
        )}

        {userStats.achievementsPointsEarnedSum !== undefined && (
          <li className="user-stats__list-item">
            <h3 className="user-stats__list-title">{t("earned_points")}</h3>
            <div className="user-stats__stats-row">
              <p className="user-stats__list-description">
                <HydraIcon width={20} height={20} />
                {numberFormatter.format(
                  userStats.achievementsPointsEarnedSum.value
                )}
              </p>
              <p title={t("ranking_updated_weekly")}>
                {t("top_percentile", {
                  percentile:
                    userStats.achievementsPointsEarnedSum.topPercentile,
                })}
              </p>
            </div>
          </li>
        )}

        <li className="user-stats__list-item">
          <h3 className="user-stats__list-title">{t("total_play_time")}</h3>
          <div className="user-stats__stats-row">
            <p className="user-stats__list-description">
              <ClockIcon />
              {formatPlayTime(userStats.totalPlayTimeInSeconds.value)}
            </p>
            <p title={t("ranking_updated_weekly")}>
              {t("top_percentile", {
                percentile: userStats.totalPlayTimeInSeconds.topPercentile,
              })}
            </p>
          </div>
        </li>

        {hasKarma && karma !== undefined && karma !== null && (
          <li className="user-stats__list-item user-stats__list-item--karma">
            <h3 className="user-stats__list-title">{t("karma")}</h3>
            <div className="user-stats__stats-row">
              <p className="user-stats__list-description">
                <Award size={20} /> {numberFormatter.format(karma)}{" "}
                {t("karma_count")}
              </p>
            </div>
          </li>
        )}
      </ul>

      {userProfile && (
        <WrappedFullscreenModal
          userId={userProfile.id}
          isOpen={showWrappedModal}
          onClose={() => setShowWrappedModal(false)}
        />
      )}
    </div>
  );
}
