import { motion } from "framer-motion";
import { useCallback, useContext, useState } from "react";
import { userProfileContext } from "@renderer/context";
import { useTranslation } from "react-i18next";
import { useFormat, useUserDetails } from "@renderer/hooks";
import { MAX_MINUTES_TO_SHOW_IN_PLAYTIME } from "@renderer/constants";
import HydraIcon from "@renderer/assets/icons/hydra.svg?react";
import { useSubscription } from "@renderer/hooks/use-subscription";
import { ClockIcon, TrophyIcon } from "@primer/octicons-react";
import { Award } from "lucide-react";
import { WrappedFullscreenModal } from "./wrapped-tab";
import "./user-stats-box.scss";

export function UserStatsBox() {
  const [showWrappedModal, setShowWrappedModal] = useState(false);
  const { showHydraCloudModal } = useSubscription();
  const { userStats, isMe, userProfile } = useContext(userProfileContext);
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

  if (!userStats) return null;

  const karma = isMe ? userDetails?.karma : userProfile?.karma;
  const hasKarma = karma !== undefined && karma !== null;

  return (
    <motion.div
      key="stats"
      className="profile-content__tab-panel user-stats__box"
      initial={{ opacity: 0, x: -10 }}
      animate={{ opacity: 1, x: 0 }}
      exit={{ opacity: 0, x: 10 }}
      transition={{ duration: 0.2 }}
      aria-hidden={false}
    >
      <div className="profile-content__section-header">
        <div className="profile-content__section-title-group">
          <h2>{t("stats", { defaultValue: "Estatísticas" })}</h2>
        </div>
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

        {(isMe || userStats.unlockedAchievementSum !== undefined) && (
          <li className="user-stats__list-item">
            <h3 className="user-stats__list-title">
              {t("achievements_unlocked")}
            </h3>
            {userStats.unlockedAchievementSum !== undefined ? (
              <div className="user-stats__stats-row">
                <p className="user-stats__list-description">
                  <TrophyIcon /> {userStats.unlockedAchievementSum}{" "}
                  {t("achievements")}
                </p>
              </div>
            ) : (
              <button
                type="button"
                onClick={() => showHydraCloudModal("achievements")}
                className="user-stats__link"
              >
                <small style={{ color: "var(--color-warning)" }}>
                  {t("show_achievements_on_profile")}
                </small>
              </button>
            )}
          </li>
        )}

        {(isMe || userStats.achievementsPointsEarnedSum !== undefined) && (
          <li className="user-stats__list-item">
            <h3 className="user-stats__list-title">{t("earned_points")}</h3>
            {userStats.achievementsPointsEarnedSum !== undefined ? (
              <div className="user-stats__stats-row">
                <p className="user-stats__list-description">
                  <HydraIcon width={24} height={24} />
                  {numberFormatter.format(
                    userStats.achievementsPointsEarnedSum.value
                  )}
                </p>
                <p
                  className="user-stats__stats-label"
                  title={t("ranking_updated_weekly")}
                >
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
                className="user-stats__link"
              >
                <small className="user-stats__link--warning">
                  {t("show_points_on_profile")}
                </small>
              </button>
            )}
          </li>
        )}

        <li className="user-stats__list-item">
          <h3 className="user-stats__list-title">{t("total_play_time")}</h3>
          <div className="user-stats__stats-row">
            <p className="user-stats__list-description">
              <ClockIcon size={24} />
              {formatPlayTime(userStats.totalPlayTimeInSeconds.value)}
            </p>
            <p
              className="user-stats__stats-label"
              title={t("ranking_updated_weekly")}
            >
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
                <Award size={24} /> {numberFormatter.format(karma)}
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
    </motion.div>
  );
}
