import { useMemo, useState } from "react";
import { motion } from "framer-motion";
import { useTranslation } from "react-i18next";
import { ChevronDownIcon, ChevronRightIcon } from "@primer/octicons-react";
import { TrashIcon } from "lucide-react";
import type { ProfileAchievement } from "@types";
import { ConfirmationModal } from "@renderer/components";
import { useDate, useToast } from "@renderer/hooks";
import { logger } from "@renderer/logger";
import "./profile-content.scss";

interface SouvenirGameGroupProps {
  achievements: ProfileAchievement[];
  isMe: boolean;
  deletingIds: Set<string>;
  onSouvenirClick: (achievement: ProfileAchievement) => void;
  onDeleteClick: (achievement: ProfileAchievement) => void;
}

function SouvenirGameGroup({
  achievements,
  isMe,
  deletingIds,
  onSouvenirClick,
  onDeleteClick,
}: Readonly<SouvenirGameGroupProps>) {
  const { t } = useTranslation("user_profile");
  const { formatDistance } = useDate();
  const [isExpanded, setIsExpanded] = useState(true);

  const [{ gameTitle, gameIconUrl }] = achievements;

  return (
    <div className="profile-content__souvenirs-group">
      <button
        type="button"
        className="profile-content__souvenirs-group-header"
        onClick={() => setIsExpanded(!isExpanded)}
      >
        {isExpanded ? <ChevronDownIcon /> : <ChevronRightIcon />}

        {gameIconUrl && (
          <img
            className="profile-content__souvenirs-group-icon"
            src={gameIconUrl}
            alt=""
            loading="lazy"
          />
        )}

        <h3 className="profile-content__souvenirs-group-title">{gameTitle}</h3>

        <span className="profile-content__tab-badge">
          {achievements.length}
        </span>
      </button>

      {isExpanded && (
        <ul className="profile-content__souvenirs-grid">
          {achievements.map((achievement) => (
            <li key={achievement.id} className="profile-content__souvenir">
              <button
                type="button"
                className="profile-content__souvenir-image-button"
                onClick={() => onSouvenirClick(achievement)}
                title={t("view_souvenir")}
              >
                <img
                  className="profile-content__souvenir-image"
                  src={achievement.imageUrl}
                  alt={achievement.displayName}
                  loading="lazy"
                />
              </button>

              <div className="profile-content__souvenir-details">
                {achievement.achievementIcon && (
                  <img
                    className="profile-content__souvenir-achievement-icon"
                    src={achievement.achievementIcon}
                    alt=""
                    loading="lazy"
                  />
                )}

                <div className="profile-content__souvenir-text">
                  <span className="profile-content__souvenir-name">
                    {achievement.displayName}
                  </span>
                  <small className="profile-content__souvenir-unlock-time">
                    {formatDistance(
                      new Date(achievement.unlockTime),
                      new Date(),
                      { addSuffix: true }
                    )}
                  </small>
                </div>

                {isMe && (
                  <button
                    type="button"
                    className="profile-content__souvenir-delete-button"
                    onClick={() => onDeleteClick(achievement)}
                    disabled={deletingIds.has(achievement.id)}
                    title={t("delete_souvenir")}
                  >
                    <TrashIcon size={14} />
                  </button>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

interface SouvenirsTabProps {
  achievements: ProfileAchievement[];
  isMe: boolean;
  onSouvenirClick: (achievement: ProfileAchievement) => void;
  onSouvenirDeleted: () => void;
}

export function SouvenirsTab({
  achievements,
  isMe,
  onSouvenirClick,
  onSouvenirDeleted,
}: Readonly<SouvenirsTabProps>) {
  const { t } = useTranslation("user_profile");
  const { showErrorToast, showSuccessToast } = useToast();

  const [deletingIds, setDeletingIds] = useState<Set<string>>(new Set());
  const [souvenirToDelete, setSouvenirToDelete] =
    useState<ProfileAchievement | null>(null);

  const groupedAchievements = useMemo(() => {
    return achievements.reduce<Record<string, ProfileAchievement[]>>(
      (groups, achievement) => {
        groups[achievement.gameId] = [
          ...(groups[achievement.gameId] ?? []),
          achievement,
        ];

        return groups;
      },
      {}
    );
  }, [achievements]);

  const handleDeleteSouvenir = async () => {
    if (!souvenirToDelete) return;

    const { id, gameId, name } = souvenirToDelete;

    setSouvenirToDelete(null);
    setDeletingIds((prev) => new Set(prev).add(id));

    try {
      await window.electron.hydraApi.delete(
        `/profile/games/achievements/${gameId}/${name}/image`
      );

      showSuccessToast(t("souvenir_deleted_successfully"));
      onSouvenirDeleted();
    } catch (error) {
      logger.error("Failed to delete souvenir", error);
      showErrorToast(t("souvenir_deletion_failed"));
    } finally {
      setDeletingIds((prev) => {
        const next = new Set(prev);
        next.delete(id);
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
    >
      {achievements.length === 0 ? (
        <p className="profile-content__souvenirs-empty">{t("no_souvenirs")}</p>
      ) : (
        Object.entries(groupedAchievements).map(
          ([gameId, groupAchievements]) => (
            <SouvenirGameGroup
              key={gameId}
              achievements={groupAchievements}
              isMe={isMe}
              deletingIds={deletingIds}
              onSouvenirClick={onSouvenirClick}
              onDeleteClick={setSouvenirToDelete}
            />
          )
        )
      )}

      <ConfirmationModal
        visible={souvenirToDelete !== null}
        title={t("delete_souvenir_modal_title")}
        descriptionText={t("delete_souvenir_modal_description")}
        confirmButtonLabel={t("delete_souvenir_modal_delete_button")}
        cancelButtonLabel={t("delete_souvenir_modal_cancel_button")}
        confirmButtonTheme="danger"
        onConfirm={handleDeleteSouvenir}
        onClose={() => setSouvenirToDelete(null)}
      />
    </motion.div>
  );
}
