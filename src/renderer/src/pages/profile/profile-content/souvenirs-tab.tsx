import { useMemo, useState } from "react";
import { motion } from "framer-motion";
import { useTranslation } from "react-i18next";
import {
  ChevronDownIcon,
  ChevronRightIcon,
  HistoryIcon,
  SearchIcon,
  StackIcon,
} from "@primer/octicons-react";
import { FilterDropdown, type FilterDropdownOption } from "./filter-dropdown";
import { TrashIcon } from "lucide-react";
import type { ProfileAchievement } from "@types";
import { ConfirmationModal } from "@renderer/components";
import { useDate, useToast } from "@renderer/hooks";
import { logger } from "@renderer/logger";
import "./profile-content.scss";

const souvenirKey = (achievement: ProfileAchievement) =>
  `${achievement.gameId}:${achievement.name}`;

type SouvenirGrouping = "game" | "none";
type SouvenirSort = "recent" | "oldest";

interface SouvenirCardProps {
  achievement: ProfileAchievement;
  isMe: boolean;
  isDeleting: boolean;
  showGame: boolean;
  onSouvenirClick: (achievement: ProfileAchievement) => void;
  onDeleteClick: (achievement: ProfileAchievement) => void;
}

function SouvenirCard({
  achievement,
  isMe,
  isDeleting,
  showGame,
  onSouvenirClick,
  onDeleteClick,
}: Readonly<SouvenirCardProps>) {
  const { t } = useTranslation("user_profile");
  const { formatDistance } = useDate();

  return (
    <li className="profile-content__souvenir">
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

        <span className="profile-content__souvenir-image-overlay">
          <SearchIcon size={24} />
        </span>
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
            {showGame
              ? (achievement.gameTitle ?? t("unknown_game"))
              : formatDistance(new Date(achievement.unlockTime), new Date(), {
                  addSuffix: true,
                })}
          </small>
        </div>

        {isMe && (
          <button
            type="button"
            className="profile-content__souvenir-delete-button"
            onClick={() => onDeleteClick(achievement)}
            disabled={isDeleting}
            title={t("delete_souvenir")}
          >
            <TrashIcon size={14} />
          </button>
        )}
      </div>
    </li>
  );
}

interface SouvenirGameGroupProps {
  achievements: ProfileAchievement[];
  isMe: boolean;
  deletingKeys: Set<string>;
  onSouvenirClick: (achievement: ProfileAchievement) => void;
  onDeleteClick: (achievement: ProfileAchievement) => void;
}

function SouvenirGameGroup({
  achievements,
  isMe,
  deletingKeys,
  onSouvenirClick,
  onDeleteClick,
}: Readonly<SouvenirGameGroupProps>) {
  const { t } = useTranslation("user_profile");
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

        <h3 className="profile-content__souvenirs-group-title">
          {gameTitle ?? t("unknown_game")}
        </h3>

        <span className="profile-content__souvenirs-group-count">
          {achievements.length}
        </span>
      </button>

      {isExpanded && (
        <ul className="profile-content__souvenirs-grid">
          {achievements.map((achievement) => (
            <SouvenirCard
              key={souvenirKey(achievement)}
              achievement={achievement}
              isMe={isMe}
              isDeleting={deletingKeys.has(souvenirKey(achievement))}
              showGame={false}
              onSouvenirClick={onSouvenirClick}
              onDeleteClick={onDeleteClick}
            />
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

  const [deletingKeys, setDeletingKeys] = useState<Set<string>>(new Set());
  const [souvenirToDelete, setSouvenirToDelete] =
    useState<ProfileAchievement | null>(null);
  const [grouping, setGrouping] = useState<SouvenirGrouping>("game");
  const [sortBy, setSortBy] = useState<SouvenirSort>("recent");

  const sortedAchievements = useMemo(() => {
    return achievements.toSorted((a, b) =>
      sortBy === "recent"
        ? b.unlockTime - a.unlockTime
        : a.unlockTime - b.unlockTime
    );
  }, [achievements, sortBy]);

  const groupedAchievements = useMemo(() => {
    return sortedAchievements.reduce<Record<string, ProfileAchievement[]>>(
      (groups, achievement) => {
        groups[achievement.gameId] = [
          ...(groups[achievement.gameId] ?? []),
          achievement,
        ];

        return groups;
      },
      {}
    );
  }, [sortedAchievements]);

  const groupingOptions: FilterDropdownOption<SouvenirGrouping>[] = [
    { value: "game", label: t("group_by_game"), icon: StackIcon },
    { value: "none", label: t("no_grouping"), icon: SearchIcon },
  ];

  const sortOptions: FilterDropdownOption<SouvenirSort>[] = [
    { value: "recent", label: t("most_recent"), icon: HistoryIcon },
    { value: "oldest", label: t("oldest_first"), icon: HistoryIcon },
  ];

  const handleDeleteSouvenir = async () => {
    if (!souvenirToDelete) return;

    const { gameId, name, gameTitle, displayName } = souvenirToDelete;
    const key = souvenirKey(souvenirToDelete);

    setSouvenirToDelete(null);
    setDeletingKeys((prev) => new Set(prev).add(key));

    try {
      await window.electron.deleteAchievementSouvenir({
        gameId,
        achievementName: name,
        gameTitle,
        achievementDisplayName: displayName,
      });

      showSuccessToast(t("souvenir_deleted_successfully"));
      onSouvenirDeleted();
    } catch (error) {
      logger.error("Failed to delete souvenir", error);
      showErrorToast(t("souvenir_deletion_failed"));
    } finally {
      setDeletingKeys((prev) => {
        const next = new Set(prev);
        next.delete(key);
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
        <>
          <div className="profile-content__library-filters">
            <FilterDropdown
              placeholder={t("group_by")}
              value={grouping}
              options={groupingOptions}
              onChange={setGrouping}
            />

            <FilterDropdown
              placeholder={t("sort_by")}
              value={sortBy}
              options={sortOptions}
              onChange={setSortBy}
            />
          </div>

          {grouping === "game" ? (
            Object.entries(groupedAchievements).map(
              ([gameId, groupAchievements]) => (
                <SouvenirGameGroup
                  key={gameId}
                  achievements={groupAchievements}
                  isMe={isMe}
                  deletingKeys={deletingKeys}
                  onSouvenirClick={onSouvenirClick}
                  onDeleteClick={setSouvenirToDelete}
                />
              )
            )
          ) : (
            <ul className="profile-content__souvenirs-grid">
              {sortedAchievements.map((achievement) => (
                <SouvenirCard
                  key={souvenirKey(achievement)}
                  achievement={achievement}
                  isMe={isMe}
                  isDeleting={deletingKeys.has(souvenirKey(achievement))}
                  showGame
                  onSouvenirClick={onSouvenirClick}
                  onDeleteClick={setSouvenirToDelete}
                />
              ))}
            </ul>
          )}
        </>
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
