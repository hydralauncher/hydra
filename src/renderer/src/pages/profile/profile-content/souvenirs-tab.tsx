import { useEffect, useMemo, useState, type SyntheticEvent } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { useTranslation } from "react-i18next";
import {
  ChevronDownIcon,
  ChevronRightIcon,
  HeartFillIcon,
  HeartIcon,
  HistoryIcon,
  ImageIcon,
  LockIcon,
  SearchIcon,
  StackIcon,
  TrophyIcon,
} from "@primer/octicons-react";
import { FilterDropdown, type FilterDropdownOption } from "./filter-dropdown";
import type { ProfileAchievement, SouvenirSort } from "@types";
import { useDate } from "@renderer/hooks";
import { getSouvenirKey, getSouvenirVisualVariant } from "@shared";
import InfiniteScroll from "react-infinite-scroll-component";
import { Button } from "@renderer/components";
import HydraIcon from "@renderer/assets/icons/hydra.svg?react";
import { useSubscription } from "@renderer/hooks/use-subscription";
import "./profile-content.scss";

const souvenirKey = (achievement: ProfileAchievement) =>
  getSouvenirKey(achievement.gameId, achievement.name);
const LIKE_ANIMATION_DURATION_MS = 400;

const hideBrokenImage = (event: SyntheticEvent<HTMLImageElement>) => {
  event.currentTarget.style.opacity = "0";
};

type SouvenirGrouping = "game" | "none";
interface SouvenirCardProps {
  achievement: ProfileAchievement;
  isLiking: boolean;
  canLike: boolean;
  showGame: boolean;
  onSouvenirClick: (achievement: ProfileAchievement) => void;
  onLikeClick: (achievement: ProfileAchievement) => void;
}

function SouvenirCard({
  achievement,
  isLiking,
  canLike,
  showGame,
  onSouvenirClick,
  onLikeClick,
}: Readonly<SouvenirCardProps>) {
  const { t } = useTranslation("user_profile");
  const { formatDistance } = useDate();
  const visualVariant = getSouvenirVisualVariant(achievement);
  const [failedThumbnailUrl, setFailedThumbnailUrl] = useState<string | null>(
    null
  );
  const [isLikeAnimating, setIsLikeAnimating] = useState(false);
  const hasThumbnail = Boolean(
    achievement.imageUrl && achievement.imageUrl !== failedThumbnailUrl
  );

  useEffect(() => {
    if (!isLikeAnimating) return;

    const timeoutId = window.setTimeout(
      () => setIsLikeAnimating(false),
      LIKE_ANIMATION_DURATION_MS
    );

    return () => window.clearTimeout(timeoutId);
  }, [isLikeAnimating]);

  const handleLikeClick = () => {
    if (isLikeAnimating || isLiking) return;
    setIsLikeAnimating(true);
    onLikeClick(achievement);
  };

  return (
    <li
      className={`profile-content__souvenir ${visualVariant ? `profile-content__souvenir--${visualVariant}` : ""}`}
    >
      <button
        type="button"
        className="profile-content__souvenir-image-button"
        onClick={() => onSouvenirClick(achievement)}
        title={t("view_souvenir")}
      >
        <span className="profile-content__souvenir-image-placeholder">
          <ImageIcon size={32} />
        </span>

        {hasThumbnail && (
          <img
            className="profile-content__souvenir-image"
            src={achievement.imageUrl ?? undefined}
            alt={achievement.displayName}
            loading="lazy"
            onError={() => setFailedThumbnailUrl(achievement.imageUrl)}
          />
        )}

        {hasThumbnail && (
          <span className="profile-content__souvenir-image-overlay">
            <SearchIcon size={24} />
          </span>
        )}
      </button>

      <motion.button
        type="button"
        className={`profile-content__souvenir-action-button ${isLikeAnimating || isLiking ? "profile-content__souvenir-action-button--pending" : ""}`}
        onClick={handleLikeClick}
        disabled={isLikeAnimating || isLiking}
        title={canLike ? t("like_souvenir") : t("sign_in_to_like_souvenir")}
        aria-pressed={achievement.likedByMe}
        whileHover={{ scale: 1.05 }}
        whileTap={{ scale: 0.95 }}
      >
        {achievement.likedByMe ? (
          <HeartFillIcon size={14} />
        ) : (
          <HeartIcon size={14} />
        )}
        <AnimatePresence mode="wait">
          <motion.span
            key={achievement.likeCount}
            initial={{ opacity: 0, y: -10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 10 }}
            transition={{ duration: 0.2 }}
          >
            {achievement.likeCount}
          </motion.span>
        </AnimatePresence>
      </motion.button>

      <div className="profile-content__souvenir-details">
        <span className="profile-content__souvenir-achievement-icon">
          <TrophyIcon size={16} />
          {achievement.achievementIcon && (
            <img
              className="profile-content__souvenir-achievement-icon-image"
              src={achievement.achievementIcon}
              alt=""
              loading="lazy"
              onError={hideBrokenImage}
            />
          )}
        </span>

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
      </div>
    </li>
  );
}

interface SouvenirGameGroupProps {
  achievements: ProfileAchievement[];
  likingKeys: Set<string>;
  canLike: boolean;
  onSouvenirClick: (achievement: ProfileAchievement) => void;
  onLikeClick: (achievement: ProfileAchievement) => void;
}

function SouvenirGameGroup({
  achievements,
  likingKeys,
  canLike,
  onSouvenirClick,
  onLikeClick,
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

        <span className="profile-content__souvenirs-group-icon">
          <ImageIcon size={14} />
          {gameIconUrl && (
            <img
              className="profile-content__souvenirs-group-icon-image"
              src={gameIconUrl}
              alt=""
              loading="lazy"
              onError={hideBrokenImage}
            />
          )}
        </span>

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
              isLiking={likingKeys.has(souvenirKey(achievement))}
              canLike={canLike}
              showGame={false}
              onSouvenirClick={onSouvenirClick}
              onLikeClick={onLikeClick}
            />
          ))}
        </ul>
      )}
    </div>
  );
}

interface SouvenirsTabProps {
  achievements: ProfileAchievement[];
  canLike: boolean;
  hasMore: boolean;
  isLoading: boolean;
  isEnabled: boolean;
  hasActiveSubscription: boolean;
  likingKeys: Set<string>;
  onSouvenirClick: (achievement: ProfileAchievement) => void;
  onLikeClick: (achievement: ProfileAchievement) => void;
  onReload: (sortBy: SouvenirSort) => Promise<boolean>;
  onLoadMore: (sortBy: SouvenirSort) => Promise<boolean>;
  onOpenSettings: () => void;
}

export function SouvenirsTab({
  achievements,
  canLike,
  hasMore,
  isLoading,
  isEnabled,
  hasActiveSubscription,
  likingKeys,
  onSouvenirClick,
  onLikeClick,
  onReload,
  onLoadMore,
  onOpenSettings,
}: Readonly<SouvenirsTabProps>) {
  const { t } = useTranslation("user_profile");
  const { t: tHydraCloud } = useTranslation("hydra_cloud");
  const { showHydraCloudModal } = useSubscription();
  const [grouping, setGrouping] = useState<SouvenirGrouping>("none");
  const [sortBy, setSortBy] = useState<SouvenirSort>("recent");

  const sortedAchievements = achievements;

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
    { value: "rare", label: t("rarest_first"), icon: TrophyIcon },
  ];

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
        <div className="profile-content__no-games profile-content__souvenirs-empty">
          {isLoading ? (
            <p>{t("loading_souvenirs")}</p>
          ) : !hasActiveSubscription ? (
            <>
              <span className="profile-content__telescope-icon">
                <LockIcon size={24} />
              </span>
              <h2>{t("souvenirs_cloud_title")}</h2>
              <p>{t("souvenirs_cloud_description")}</p>
              <Button
                theme="outline"
                className="profile-content__souvenirs-empty-action"
                onClick={() => showHydraCloudModal("achievements")}
              >
                <HydraIcon className="profile-content__souvenirs-empty-hydra-icon" />
                <span>{tHydraCloud("learn_more")}</span>
              </Button>
            </>
          ) : (
            <>
              <h2>
                {t(isEnabled ? "no_souvenirs" : "souvenirs_disabled_title")}
              </h2>
              <p>
                {t(
                  isEnabled
                    ? "no_souvenirs_description"
                    : "souvenirs_disabled_description"
                )}
              </p>
              {!isEnabled && (
                <Button
                  theme="outline"
                  className="profile-content__souvenirs-empty-action"
                  onClick={onOpenSettings}
                >
                  {t("open_souvenir_settings")}
                </Button>
              )}
            </>
          )}
        </div>
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
              onChange={(value) => {
                setSortBy(value);
                void onReload(value);
              }}
            />
          </div>

          <InfiniteScroll
            dataLength={achievements.length}
            next={() => onLoadMore(sortBy)}
            hasMore={hasMore}
            loader={
              <p className="profile-content__souvenirs-loading">
                {t("loading_souvenirs")}
              </p>
            }
            scrollThreshold={0.9}
            style={{ overflow: "visible" }}
            scrollableTarget="scrollableDiv"
          >
            {grouping === "game" ? (
              Object.entries(groupedAchievements).map(
                ([gameId, groupAchievements]) => (
                  <SouvenirGameGroup
                    key={gameId}
                    achievements={groupAchievements}
                    canLike={canLike}
                    likingKeys={likingKeys}
                    onSouvenirClick={onSouvenirClick}
                    onLikeClick={onLikeClick}
                  />
                )
              )
            ) : (
              <ul className="profile-content__souvenirs-grid">
                {sortedAchievements.map((achievement) => (
                  <SouvenirCard
                    key={souvenirKey(achievement)}
                    achievement={achievement}
                    canLike={canLike}
                    isLiking={likingKeys.has(souvenirKey(achievement))}
                    showGame
                    onSouvenirClick={onSouvenirClick}
                    onLikeClick={onLikeClick}
                  />
                ))}
              </ul>
            )}
          </InfiniteScroll>
        </>
      )}
    </motion.div>
  );
}
