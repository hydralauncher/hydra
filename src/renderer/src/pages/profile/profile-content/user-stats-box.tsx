import { useCallback, useContext } from "react";
import { userProfileContext } from "@renderer/context";
import { useTranslation } from "react-i18next";
import { useFormat } from "@renderer/hooks";
import { MAX_MINUTES_TO_SHOW_IN_PLAYTIME } from "@renderer/constants";
import HydraIcon from "@renderer/assets/icons/hydra.svg?react";
import { useSubscription } from "@renderer/hooks/use-subscription";
import { ClockIcon, TrophyIcon } from "@primer/octicons-react";

import "./profile-content.scss";

export function UserStatsBox() {
  const { showHydraCloudModal } = useSubscription();
  const { userStats, isMe } = useContext(userProfileContext);
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

  if (!userStats) return null;

  return (
    <div>
      <div className="profile-content__section-header">
        <h2>{t("stats")}</h2>
      </div>

      <div className="profile-content__box">
        <ul className="profile-content__list">
          {(isMe || userStats.unlockedAchievementSum !== undefined) && (
            <li className="profile-content__list-item">
              <h3 className="profile-content__list-item-title">
                {t("achievements_unlocked")}
              </h3>
              {userStats.unlockedAchievementSum !== undefined ? (
                <div
                  style={{ display: "flex", justifyContent: "space-between" }}
                >
                  <p className="profile-content__list-item-description">
                    <TrophyIcon /> {userStats.unlockedAchievementSum}{" "}
                    {t("achievements")}
                  </p>
                </div>
              ) : (
                <button
                  type="button"
                  onClick={() => showHydraCloudModal("achievements")}
                  className="profile-content__link"
                >
                  <small style={{ color: "#ffc107" }}>
                    {t("show_achievements_on_profile")}
                  </small>
                </button>
              )}
            </li>
          )}

          {(isMe || userStats.achievementsPointsEarnedSum !== undefined) && (
            <li className="profile-content__stats-list-item">
              <h3 className="profile-content__list-item-title">
                {t("earned_points")}
              </h3>
              {userStats.achievementsPointsEarnedSum !== undefined ? (
                <div
                  style={{ display: "flex", justifyContent: "space-between" }}
                >
                  <p className="profile-content__list-item-description">
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
              ) : (
                <button
                  type="button"
                  onClick={() => showHydraCloudModal("achievements-points")}
                  className="profile-content__link"
                >
                  <small style={{ color: "#ffc107" }}>
                    {t("show_points_on_profile")}
                  </small>
                </button>
              )}
            </li>
          )}

          <li className="profile-content__list-item">
            <h3 className="profile-content__list-item-title">
              {t("total_play_time")}
            </h3>
            <div style={{ display: "flex", justifyContent: "space-between" }}>
              <p className="profile-content__list-item-description">
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
        </ul>
      </div>
    </div>
  );
}
