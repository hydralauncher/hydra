import { useDate } from "@renderer/hooks";
import type { UserAchievement } from "@types";
import { useTranslation } from "react-i18next";
import "./achievements.scss";
import { EyeClosedIcon, SearchIcon } from "@primer/octicons-react";
import HydraIcon from "@renderer/assets/icons/hydra.svg?react";
import { useSubscription } from "@renderer/hooks/use-subscription";
import { useState } from "react";
import { FullscreenMediaModal } from "@renderer/components";

interface AchievementListProps {
  achievements: UserAchievement[];
}

export function AchievementList({
  achievements,
}: Readonly<AchievementListProps>) {
  const { t } = useTranslation("achievement");
  const { showHydraCloudModal } = useSubscription();
  const { formatDateTime } = useDate();

  const [souvenir, setSouvenir] = useState<{
    src: string;
    alt: string;
  } | null>(null);

  return (
    <ul className="achievements__list">
      {achievements.map((achievement) => (
        <li key={achievement.name} className="achievements__item">
          <img
            className={`achievements__item-image ${!achievement.unlocked ? "achievements__item-image--locked" : ""}`}
            src={achievement.icon}
            alt={achievement.displayName}
            loading="lazy"
          />

          <div className="achievements__item-content">
            <h4 className="achievements__item-title">
              {achievement.hidden && (
                <span
                  className="achievements__item-hidden-icon"
                  title={t("hidden_achievement_tooltip")}
                >
                  <EyeClosedIcon size={12} />
                </span>
              )}
              {achievement.displayName}
              {achievement.hardcoreUnlockTime != null && (
                <span
                  className="achievements__item-hardcore-badge"
                  title={t("hardcore_unlocked_at", {
                    date: formatDateTime(achievement.hardcoreUnlockTime),
                  })}
                >
                  {t("hardcore")}
                </span>
              )}
            </h4>
            <p>{achievement.description}</p>
          </div>

          <div className="achievements__item-meta">
            {achievement.unlocked && achievement.imageUrl && (
              <button
                type="button"
                className="achievements__item-souvenir"
                onClick={() =>
                  setSouvenir({
                    src: achievement.imageUrl!,
                    alt: t("souvenir_alt", {
                      achievement: achievement.displayName,
                    }),
                  })
                }
                title={t("view_souvenir")}
              >
                <img
                  className="achievements__item-souvenir-image"
                  src={achievement.imageUrl}
                  alt={t("souvenir_alt", {
                    achievement: achievement.displayName,
                  })}
                  loading="lazy"
                />

                <span className="achievements__item-souvenir-overlay">
                  <SearchIcon size={20} />
                </span>
              </button>
            )}

            <div className="achievements__item-meta-details">
              {achievement.points != undefined ? (
                <div
                  className="achievements__item-points"
                  title={t("achievement_earn_points", {
                    points: achievement.points,
                  })}
                >
                  <HydraIcon className="achievements__item-points-icon" />
                  <p className="achievements__item-points-value">
                    {achievement.points}
                  </p>
                </div>
              ) : (
                <button
                  onClick={() => showHydraCloudModal("achievements")}
                  className="achievements__item-points achievements__item-points--locked"
                  title={t("achievement_earn_points", { points: "???" })}
                >
                  <HydraIcon className="achievements__item-points-icon" />
                  <p className="achievements__item-points-value">???</p>
                </button>
              )}
              {achievement.unlockTime != null && (
                <div
                  className="achievements__item-unlock-time"
                  title={t("unlocked_at", {
                    date: formatDateTime(achievement.unlockTime),
                  })}
                >
                  <small>{formatDateTime(achievement.unlockTime)}</small>
                </div>
              )}
            </div>
          </div>
        </li>
      ))}

      <FullscreenMediaModal
        visible={souvenir !== null}
        src={souvenir?.src}
        alt={souvenir?.alt}
        upscale
        onClose={() => setSouvenir(null)}
      />
    </ul>
  );
}
