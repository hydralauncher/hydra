import * as styles from "./profile-content.css";
import { useCallback, useContext } from "react";
import { userProfileContext } from "@renderer/context";
import { useTranslation } from "react-i18next";
import { useFormat } from "@renderer/hooks";
import { MAX_MINUTES_TO_SHOW_IN_PLAYTIME } from "@renderer/constants";
import HydraIcon from "@renderer/assets/icons/hydra.svg?react";
import { useSubscription } from "@renderer/hooks/use-subscription";
import { ClockIcon, TrophyIcon } from "@primer/octicons-react";
import { vars } from "@renderer/theme.css";

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
      <div className={styles.sectionHeader}>
        <h2>{t("stats")}</h2>
      </div>

      <div className={styles.box}>
        <ul className={styles.list}>
          {(isMe || userStats.unlockedAchievementSum !== undefined) && (
            <li className={styles.statsListItem}>
              <h3 className={styles.listItemTitle}>
                {t("achievements_unlocked")}
              </h3>
              {userStats.unlockedAchievementSum !== undefined ? (
                <div
                  style={{ display: "flex", justifyContent: "space-between" }}
                >
                  <p className={styles.listItemDescription}>
                    <TrophyIcon /> {userStats.unlockedAchievementSum}{" "}
                    {t("achievements")}
                  </p>
                </div>
              ) : (
                <button
                  type="button"
                  onClick={() => showHydraCloudModal("achievements")}
                  className={styles.link}
                >
                  <small style={{ color: vars.color.warning }}>
                    {t("show_achievements_on_profile")}
                  </small>
                </button>
              )}
            </li>
          )}

          {(isMe || userStats.achievementsPointsEarnedSum !== undefined) && (
            <li className={styles.statsListItem}>
              <h3 className={styles.listItemTitle}>{t("earned_points")}</h3>
              {userStats.achievementsPointsEarnedSum !== undefined ? (
                <div
                  style={{ display: "flex", justifyContent: "space-between" }}
                >
                  <p className={styles.listItemDescription}>
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
                  className={styles.link}
                >
                  <small style={{ color: vars.color.warning }}>
                    {t("show_points_on_profile")}
                  </small>
                </button>
              )}
            </li>
          )}

          <li className={styles.statsListItem}>
            <h3 className={styles.listItemTitle}>{t("total_play_time")}</h3>
            <div style={{ display: "flex", justifyContent: "space-between" }}>
              <p className={styles.listItemDescription}>
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
