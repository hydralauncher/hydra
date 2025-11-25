import { motion } from "framer-motion";
import { useTranslation } from "react-i18next";
import { ChevronDownIcon, ChevronRightIcon } from "@primer/octicons-react";
import { TrashIcon, Maximize2 } from "lucide-react";
import { useState, useMemo } from "react";
import type { ProfileAchievement } from "@types";
import { useToast, useDate } from "@renderer/hooks";
import { logger } from "@renderer/logger";
import { DeleteSouvenirModal } from "./delete-souvenir-modal";
import "./profile-content.scss";

interface SouvenirGameGroupProps {
  gameTitle: string;
  gameIconUrl: string | null;
  achievements: ProfileAchievement[];
  isMe: boolean;
  deletingIds: Set<string>;
  onImageClick: (imageUrl: string, achievementName: string) => void;
  onDeleteClick: (achievement: ProfileAchievement) => void;
}

function SouvenirGameGroup({
  gameTitle,
  gameIconUrl,
  achievements,
  isMe,
  deletingIds,
  onImageClick,
  onDeleteClick,
}: Readonly<SouvenirGameGroupProps>) {
  const { formatDistance } = useDate();
  const [isExpanded, setIsExpanded] = useState(true);

  return (
    <div className="profile-content__images-section">
      <button
        className="profile-content__section-header"
        onClick={() => setIsExpanded(!isExpanded)}
        type="button"
        style={{
          width: "100%",
          background: "none",
          border: "none",
          cursor: "pointer",
          color: "inherit",
          padding: 0,
        }}
      >
        <div className="profile-content__section-title-group">
          <div className="profile-content__collapse-button">
            {isExpanded ? <ChevronDownIcon /> : <ChevronRightIcon />}
          </div>

          {gameIconUrl && (
            <img
              src={gameIconUrl}
              alt=""
              style={{
                width: 24,
                height: 24,
                borderRadius: 4,
                objectFit: "cover",
              }}
            />
          )}

          <h3 style={{ fontSize: 16, fontWeight: 600, margin: 0 }}>
            {gameTitle}
          </h3>

          <span className="profile-content__section-badge">
            {achievements.length}
          </span>
        </div>
      </button>

      {isExpanded && (
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
                    <Maximize2 size={24} />
                  </div>
                  <span className="profile-content__image-unlock-time">
                    {formatDistance(
                      new Date(achievement.unlockTime),
                      new Date(),
                      {
                        addSuffix: true,
                      }
                    )}
                  </span>
                </div>
              </div>

              <div className="profile-content__image-card-content">
                <div className="profile-content__image-card-row">
                  {achievement.achievementIcon && (
                    <img
                      src={achievement.achievementIcon}
                      alt=""
                      className="profile-content__image-achievement-icon profile-content__image-achievement-icon--large"
                      loading="lazy"
                    />
                  )}

                  <div className="profile-content__image-achievement-text">
                    <span className="profile-content__image-achievement-name">
                      {achievement.displayName}
                    </span>
                    <p className="profile-content__image-achievement-description">
                      {achievement.description}
                    </p>
                  </div>

                  <div className="profile-content__image-card-right">
                    {isMe && (
                      <button
                        type="button"
                        className="profile-content__image-delete-button"
                        onClick={() => onDeleteClick(achievement)}
                        aria-label={`Delete ${achievement.displayName} souvenir`}
                        disabled={deletingIds.has(achievement.id)}
                      >
                        <TrashIcon size={14} />
                      </button>
                    )}
                  </div>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

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
  const [achievementToDelete, setAchievementToDelete] =
    useState<ProfileAchievement | null>(null);
  const [deleteModalVisible, setDeleteModalVisible] = useState(false);

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

  const handleDeleteClick = (achievement: ProfileAchievement) => {
    setAchievementToDelete(achievement);
    setDeleteModalVisible(true);
  };

  const handleDeleteConfirm = () => {
    if (achievementToDelete) {
      handleDeleteAchievement(achievementToDelete);
      setAchievementToDelete(null);
    }
  };

  const handleDeleteCancel = () => {
    setDeleteModalVisible(false);
    setAchievementToDelete(null);
  };

  const groupedAchievements = useMemo(() => {
    const groups: Record<string, ProfileAchievement[]> = {};
    for (const achievement of achievements) {
      if (!groups[achievement.gameId]) {
        groups[achievement.gameId] = [];
      }
      groups[achievement.gameId].push(achievement);
    }
    return groups;
  }, [achievements]);

  return (
    <>
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

        {Object.entries(groupedAchievements).map(
          ([gameId, groupAchievements]) => {
            const firstAchievement = groupAchievements[0];
            return (
              <SouvenirGameGroup
                key={gameId}
                gameTitle={firstAchievement.gameTitle}
                gameIconUrl={firstAchievement.gameIconUrl}
                achievements={groupAchievements}
                isMe={isMe}
                deletingIds={deletingIds}
                onImageClick={onImageClick}
                onDeleteClick={handleDeleteClick}
              />
            );
          }
        )}
      </motion.div>

      <DeleteSouvenirModal
        visible={deleteModalVisible}
        onClose={handleDeleteCancel}
        onConfirm={handleDeleteConfirm}
      />
    </>
  );
}
