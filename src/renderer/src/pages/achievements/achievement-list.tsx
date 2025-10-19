import { useDate } from "@renderer/hooks";
import type { UserAchievement } from "@types";
import { useTranslation } from "react-i18next";
import "./achievements.scss";
import { EyeClosedIcon, SearchIcon } from "@primer/octicons-react";
import HydraIcon from "@renderer/assets/icons/hydra.svg?react";
import { useSubscription } from "@renderer/hooks/use-subscription";
import { useState } from "react";
import { FullscreenImageModal } from "@renderer/components/fullscreen-image-modal";

interface AchievementListProps {
  achievements: UserAchievement[];
}

export function AchievementList({
  achievements,
}: Readonly<AchievementListProps>) {
  const { t } = useTranslation("achievement");
  const { showHydraCloudModal } = useSubscription();
  const { formatDateTime } = useDate();
  const [fullscreenImage, setFullscreenImage] = useState<{
    url: string;
    alt: string;
  } | null>(null);

  const handleImageClick = (imageUrl: string, achievementName: string) => {
    setFullscreenImage({
      url: imageUrl,
      alt: `${achievementName} screenshot`,
    });
  };

  const closeFullscreenImage = () => {
    setFullscreenImage(null);
  };

  return (
    <ul className="achievements__list">
      {achievements.map((achievement) => (
        <li key={achievement.name} className="achievements__item">
          <div className="achievements__item-icon-container">
            <img
              className={`achievements__item-image ${!achievement.unlocked ? "achievements__item-image--locked" : ""}`}
              src={achievement.icon}
              alt={achievement.displayName}
              loading="lazy"
            />
          </div>

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
            </h4>
            <p>{achievement.description}</p>
          </div>

          <div className="achievements__item-meta">
            {achievement.achievementImageUrl && achievement.unlocked && (
              <div className="achievements__item-image-container">
                <div className="achievements__item-custom-image-wrapper">
                  <button
                    type="button"
                    className="achievements__item-image-button"
                    onClick={() =>
                      handleImageClick(
                        achievement.achievementImageUrl!,
                        achievement.displayName
                      )
                    }
                    aria-label={`View ${achievement.displayName} screenshot in fullscreen`}
                    style={{ cursor: "pointer", padding: 0, border: "none", background: "transparent" }}
                  >
                    <img
                      className="achievements__item-custom-image"
                      src={achievement.achievementImageUrl}
                      alt={`${achievement.displayName} screenshot`}
                      loading="lazy"
                    />
                  </button>
                  <div className="achievements__item-custom-image-overlay">
                    <SearchIcon size={20} />
                  </div>
                </div>
              </div>
            )}

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
        </li>
      ))}

      <FullscreenImageModal
        isOpen={fullscreenImage !== null}
        imageUrl={fullscreenImage?.url || ""}
        imageAlt={fullscreenImage?.alt || ""}
        onClose={closeFullscreenImage}
      />
    </ul>
  );
}
