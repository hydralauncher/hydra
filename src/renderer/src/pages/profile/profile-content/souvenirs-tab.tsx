import { motion } from "framer-motion";
import { useTranslation } from "react-i18next";
import { SearchIcon, XIcon } from "@primer/octicons-react";
import { useState } from "react";
import type { ProfileAchievement } from "@types";
import { useToast } from "@renderer/hooks";
import { logger } from "@renderer/logger";
import "./profile-content.scss";

interface SouvenirsTabProps {
  achievements: ProfileAchievement[];
  onImageClick: (imageUrl: string, achievementName: string) => void;
  isMe: boolean;
  onAchievementDeleted: () => void;
}

export function SouvenirsTab({
  achievements,
  onImageClick,
  isMe,
  onAchievementDeleted,
}: Readonly<SouvenirsTabProps>) {
  const { t } = useTranslation("user_profile");
  const { showSuccessToast, showErrorToast } = useToast();
  const [deletingIds, setDeletingIds] = useState<Set<string>>(new Set());

  const handleDeleteAchievement = async (achievement: ProfileAchievement) => {
    if (deletingIds.has(achievement.id)) return;

    setDeletingIds((prev) => new Set(prev).add(achievement.id));

    try {
      await window.electron.hydraApi.delete(
        `/profile/games/achievements/${achievement.gameId}/${achievement.name}/image`
      );

      showSuccessToast(
        t("souvenir_deleted_successfully", "Souvenir deleted successfully")
      );
      onAchievementDeleted();
    } catch (error) {
      logger.error("Failed to delete souvenir:", error);
      showErrorToast(
        t("souvenir_deletion_failed", "Failed to delete souvenir")
      );
      setDeletingIds((prev) => {
        const next = new Set(prev);
        next.delete(achievement.id);
        return next;
      });
    }
  };

  return (
    <motion.div
      key="souvenirs"
      className="profile-content__tab-panel"
      initial={{ opacity: 0, x: -10 }}
      animate={{ opacity: 1, x: 0 }}
      exit={{ opacity: 0, x: 10 }}
      transition={{ duration: 0.2 }}
      aria-hidden={false}
    >
      {achievements.length === 0 && (
        <div className="profile-content__no-souvenirs">
          <p>{t("no_souvenirs", "No souvenirs yet")}</p>
        </div>
      )}
      {achievements.length > 0 && (
        <div className="profile-content__images-grid">
          {achievements.map((achievement, index) => (
            <div
              key={`${achievement.gameTitle}-${achievement.name}-${index}`}
              className="profile-content__image-card"
            >
              <div className="profile-content__image-card-header">
                <div className="profile-content__image-achievement-image-wrapper">
                  <button
                    type="button"
                    className="profile-content__image-button"
                    onClick={() =>
                      onImageClick(
                        achievement.imageUrl,
                        achievement.displayName
                      )
                    }
                    aria-label={`View ${achievement.displayName} screenshot in fullscreen`}
                    style={{
                      cursor: "pointer",
                      padding: 0,
                      border: "none",
                      background: "transparent",
                    }}
                  >
                    <img
                      src={achievement.imageUrl}
                      alt={achievement.displayName}
                      className="profile-content__image-achievement-image"
                      loading="lazy"
                    />
                  </button>
                  <div className="profile-content__image-achievement-image-overlay">
                    <SearchIcon size={20} />
                  </div>
                  {isMe && (
                    <button
                      type="button"
                      className="profile-content__image-delete-button"
                      onClick={() => handleDeleteAchievement(achievement)}
                      aria-label={`Delete ${achievement.displayName} souvenir`}
                      disabled={deletingIds.has(achievement.id)}
                      style={{
                        cursor: deletingIds.has(achievement.id)
                          ? "not-allowed"
                          : "pointer",
                      }}
                    >
                      <XIcon size={16} />
                    </button>
                  )}
                </div>
              </div>

              <div className="profile-content__image-card-content">
                <div className="profile-content__image-achievement-info">
                  {achievement.achievementIcon && (
                    <img
                      src={achievement.achievementIcon}
                      alt=""
                      className="profile-content__image-achievement-icon"
                      loading="lazy"
                    />
                  )}
                  <span className="profile-content__image-achievement-name">
                    {achievement.displayName}
                  </span>
                </div>

                <div className="profile-content__image-game-info">
                  <div className="profile-content__image-game-left">
                    {achievement.gameIconUrl && (
                      <img
                        src={achievement.gameIconUrl}
                        alt=""
                        className="profile-content__image-game-icon"
                        loading="lazy"
                      />
                    )}
                    <span className="profile-content__image-game-title">
                      {achievement.gameTitle}
                    </span>
                  </div>
                </div>
              </div>

              <div className="profile-content__image-card-gradient-overlay"></div>
            </div>
          ))}
        </div>
      )}
    </motion.div>
  );
}
