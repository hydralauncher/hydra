import { useEffect, useMemo, useState, type SyntheticEvent } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { useTranslation } from "react-i18next";
import {
  ChevronDownIcon,
  ChevronRightIcon,
  AlertIcon,
  EyeClosedIcon,
  GlobeIcon,
  HeartFillIcon,
  HeartIcon,
  HistoryIcon,
  ImageIcon,
  LockIcon,
  PeopleIcon,
  SearchIcon,
  StackIcon,
  SyncIcon,
  TrophyIcon,
  XIcon,
} from "@primer/octicons-react";
import { FilterDropdown, type FilterDropdownOption } from "./filter-dropdown";
import type {
  AchievementSouvenirSyncStatus,
  ProfileSouvenir,
  ProfileVisibility,
  SouvenirsHiddenReason,
  SouvenirSort,
} from "@types";
import { useDate } from "@renderer/hooks";
import {
  getPrimarySouvenirAchievement,
  getSouvenirKey,
  getSouvenirVisualVariant,
  shouldShowSouvenirContentWarning,
} from "@shared";
import InfiniteScroll from "react-infinite-scroll-component";
import { Button } from "@renderer/components";
import HydraIcon from "@renderer/assets/icons/hydra.svg?react";
import { useSubscription } from "@renderer/hooks/use-subscription";
import { LockedProfile } from "./locked-profile";
import "./profile-content.scss";

const souvenirKey = (souvenir: ProfileSouvenir) => getSouvenirKey(souvenir.id);
const LIKE_ANIMATION_DURATION_MS = 400;
const SOUVENIR_VISIBILITY_ACKNOWLEDGEMENT_KEY =
  "souvenir-visibility-acknowledged";

const getSouvenirVisibilityAcknowledgementKey = (userId: string) =>
  `${SOUVENIR_VISIBILITY_ACKNOWLEDGEMENT_KEY}:${userId}`;

const hideBrokenImage = (event: SyntheticEvent<HTMLImageElement>) => {
  event.currentTarget.style.opacity = "0";
};

const getSouvenirCardClassName = (
  visualVariant: ReturnType<typeof getSouvenirVisualVariant>
) =>
  visualVariant
    ? `profile-content__souvenir profile-content__souvenir--${visualVariant}`
    : "profile-content__souvenir";

type SouvenirGrouping = "game" | "none";
interface SouvenirCardProps {
  achievement: ProfileSouvenir;
  isLiking: boolean;
  canLike: boolean;
  disableNsfwAlert: boolean;
  showGame: boolean;
  onSouvenirClick: (achievement: ProfileSouvenir) => void;
  onLikeClick: (achievement: ProfileSouvenir) => void;
}

function SouvenirCard({
  achievement,
  isLiking,
  canLike,
  disableNsfwAlert,
  showGame,
  onSouvenirClick,
  onLikeClick,
}: Readonly<SouvenirCardProps>) {
  const { t } = useTranslation("user_profile");
  const { formatDistance } = useDate();
  const primaryAchievement = getPrimarySouvenirAchievement(achievement);
  const visualVariant = getSouvenirVisualVariant(primaryAchievement);
  const otherAchievementCount = Math.max(
    0,
    achievement.achievements.length - 1
  );
  const [failedThumbnailUrl, setFailedThumbnailUrl] = useState<string | null>(
    null
  );
  const [isLikeAnimating, setIsLikeAnimating] = useState(false);
  const hasThumbnail = Boolean(
    achievement.imageUrl && achievement.imageUrl !== failedThumbnailUrl
  );
  const shouldBlurThumbnail = shouldShowSouvenirContentWarning(
    achievement,
    disableNsfwAlert
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
    <li className={getSouvenirCardClassName(visualVariant)}>
      <button
        type="button"
        className={`profile-content__souvenir-image-button${shouldBlurThumbnail ? " profile-content__souvenir-image-button--content-warning" : ""}`}
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
            alt={primaryAchievement.displayName}
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

      <div className="profile-content__souvenir-actions">
        {achievement.visibility === "PRIVATE" ? (
          <span
            className="profile-content__souvenir-private-indicator"
            title={t("private_souvenir")}
            aria-label={t("private_souvenir")}
          >
            <EyeClosedIcon size={14} />
          </span>
        ) : null}

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
      </div>

      <div className="profile-content__souvenir-details">
        <span className="profile-content__souvenir-achievement-icon">
          <TrophyIcon size={16} />
          {primaryAchievement.achievementIcon && (
            <img
              className="profile-content__souvenir-achievement-icon-image"
              src={primaryAchievement.achievementIcon}
              alt=""
              loading="lazy"
              onError={hideBrokenImage}
            />
          )}
        </span>

        <div className="profile-content__souvenir-text">
          <span className="profile-content__souvenir-name">
            <span className="profile-content__souvenir-title">
              {primaryAchievement.displayName}
            </span>
            {otherAchievementCount > 0 ? (
              <sup className="profile-content__souvenir-other-count">
                +{otherAchievementCount}
              </sup>
            ) : null}
          </span>
          <small className="profile-content__souvenir-unlock-time">
            {showGame
              ? (achievement.gameTitle ?? t("unknown_game"))
              : formatDistance(
                  new Date(primaryAchievement.unlockTime),
                  new Date(),
                  {
                    addSuffix: true,
                  }
                )}
          </small>
        </div>
      </div>
    </li>
  );
}

interface SouvenirGameGroupProps {
  achievements: ProfileSouvenir[];
  likingKeys: Set<string>;
  canLike: boolean;
  disableNsfwAlert: boolean;
  onSouvenirClick: (achievement: ProfileSouvenir) => void;
  onLikeClick: (achievement: ProfileSouvenir) => void;
}

function SouvenirGameGroup({
  achievements,
  likingKeys,
  canLike,
  disableNsfwAlert,
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
              disableNsfwAlert={disableNsfwAlert}
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

interface SouvenirsEmptyStateProps {
  isLoading: boolean;
  hiddenReason: SouvenirsHiddenReason;
  isMe: boolean;
  hasActiveSubscription: boolean;
  isEnabled: boolean;
  onOpenSettings: () => void;
}

function SouvenirsEmptyState({
  isLoading,
  hiddenReason,
  isMe,
  hasActiveSubscription,
  isEnabled,
  onOpenSettings,
}: Readonly<SouvenirsEmptyStateProps>) {
  const { t } = useTranslation("user_profile");
  const { t: tHydraCloud } = useTranslation("hydra_cloud");
  const { showHydraCloudModal } = useSubscription();

  if (isLoading) {
    return (
      <div className="profile-content__no-games profile-content__souvenirs-empty">
        <p>{t("loading_souvenirs")}</p>
      </div>
    );
  }

  if (!isMe && hiddenReason) {
    return (
      <div className="profile-content__souvenirs-empty">
        <LockedProfile title={t("locked_souvenirs")} />
      </div>
    );
  }

  if (!isMe) {
    return (
      <div className="profile-content__no-games profile-content__souvenirs-empty">
        <h2>{t("no_user_souvenirs")}</h2>
        <p>{t("no_user_souvenirs_description")}</p>
      </div>
    );
  }

  if (!hasActiveSubscription) {
    return (
      <div className="profile-content__no-games profile-content__souvenirs-empty">
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
      </div>
    );
  }

  const titleKey = isEnabled ? "no_souvenirs" : "souvenirs_disabled_title";
  const descriptionKey = isEnabled
    ? "no_souvenirs_description"
    : "souvenirs_disabled_description";

  return (
    <div className="profile-content__no-games profile-content__souvenirs-empty">
      <h2>{t(titleKey)}</h2>
      <p>{t(descriptionKey)}</p>
      {!isEnabled && (
        <Button
          theme="outline"
          className="profile-content__souvenirs-empty-action"
          onClick={onOpenSettings}
        >
          {t("open_souvenir_settings")}
        </Button>
      )}
    </div>
  );
}

interface SouvenirsTabProps {
  achievements: ProfileSouvenir[];
  hiddenReason: SouvenirsHiddenReason;
  canLike: boolean;
  disableNsfwAlert: boolean;
  hasMore: boolean;
  isLoading: boolean;
  isEnabled: boolean;
  isMe: boolean;
  userId: string;
  visibility: ProfileVisibility;
  hasActiveSubscription: boolean;
  likingKeys: Set<string>;
  onSouvenirClick: (achievement: ProfileSouvenir) => void;
  onLikeClick: (achievement: ProfileSouvenir) => void;
  onReload: (sortBy: SouvenirSort) => Promise<boolean>;
  onLoadMore: (sortBy: SouvenirSort) => Promise<boolean>;
  onOpenSettings: () => void;
}

export function SouvenirsTab({
  achievements,
  hiddenReason,
  canLike,
  disableNsfwAlert,
  hasMore,
  isLoading,
  isEnabled,
  isMe,
  userId,
  visibility,
  hasActiveSubscription,
  likingKeys,
  onSouvenirClick,
  onLikeClick,
  onReload,
  onLoadMore,
  onOpenSettings,
}: Readonly<SouvenirsTabProps>) {
  const { t } = useTranslation("user_profile");
  const { t: tSettings } = useTranslation("settings");
  const [grouping, setGrouping] = useState<SouvenirGrouping>("none");
  const [sortBy, setSortBy] = useState<SouvenirSort>("recent");
  const [isPrivacyNoticeVisible, setIsPrivacyNoticeVisible] = useState(false);
  const [syncStatus, setSyncStatus] = useState<AchievementSouvenirSyncStatus>({
    pendingCount: 0,
    failedCount: 0,
  });
  const [isRetryingSync, setIsRetryingSync] = useState(false);
  const privacyNotices = {
    PRIVATE: {
      icon: LockIcon,
      title: t("souvenirs_visibility_private_title"),
      description: t("souvenirs_visibility_private_description"),
    },
    FRIENDS: {
      icon: PeopleIcon,
      title: t("souvenirs_visibility_friends_title"),
      description: t("souvenirs_visibility_friends_description"),
    },
    PUBLIC: {
      icon: GlobeIcon,
      title: t("souvenirs_visibility_public_title"),
      description: t("souvenirs_visibility_public_description"),
    },
  } satisfies Record<
    ProfileVisibility,
    { icon: typeof LockIcon; title: string; description: string }
  >;
  const privacyNotice = privacyNotices[visibility];
  const PrivacyIcon = privacyNotice.icon;

  useEffect(() => {
    if (!isMe) {
      setIsPrivacyNoticeVisible(false);
      return;
    }

    const storageKey = getSouvenirVisibilityAcknowledgementKey(userId);
    const acknowledgedVisibility = localStorage.getItem(storageKey);

    if (!acknowledgedVisibility) {
      localStorage.setItem(storageKey, visibility);
      setIsPrivacyNoticeVisible(false);
      return;
    }

    setIsPrivacyNoticeVisible(acknowledgedVisibility !== visibility);
  }, [isMe, userId, visibility]);

  useEffect(() => {
    if (!isMe) {
      setSyncStatus({ pendingCount: 0, failedCount: 0 });
      return;
    }

    void window.electron.getAchievementSouvenirSyncStatus().then(setSyncStatus);
    return window.electron.onAchievementSouvenirSyncStatus(setSyncStatus);
  }, [isMe]);

  const handleRetrySync = async () => {
    if (isRetryingSync) return;

    setIsRetryingSync(true);
    try {
      setSyncStatus(await window.electron.retryAchievementSouvenirSync());
    } catch {
      const currentStatus = await window.electron
        .getAchievementSouvenirSyncStatus()
        .catch(() => null);
      if (currentStatus) setSyncStatus(currentStatus);
    } finally {
      setIsRetryingSync(false);
    }
  };

  const hasSyncIssues =
    syncStatus.pendingCount > 0 || syncStatus.failedCount > 0;

  const dismissPrivacyNotice = () => {
    localStorage.setItem(
      getSouvenirVisibilityAcknowledgementKey(userId),
      visibility
    );
    setIsPrivacyNoticeVisible(false);
  };

  const sortedAchievements = achievements;

  const groupedAchievements = useMemo(() => {
    return sortedAchievements.reduce<Record<string, ProfileSouvenir[]>>(
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
      {isMe && isPrivacyNoticeVisible ? (
        <aside className="profile-content__souvenirs-privacy-notice">
          <span className="profile-content__souvenirs-privacy-notice-icon">
            <PrivacyIcon size={18} />
          </span>
          <div className="profile-content__souvenirs-privacy-notice-copy">
            <strong>{privacyNotice.title}</strong>
            <span>{privacyNotice.description}</span>
          </div>
          <button
            type="button"
            className="profile-content__souvenirs-privacy-notice-dismiss"
            onClick={dismissPrivacyNotice}
            aria-label={t("dismiss_souvenirs_visibility_notice")}
            title={t("dismiss_souvenirs_visibility_notice")}
          >
            <XIcon size={16} />
          </button>
        </aside>
      ) : null}

      {hasSyncIssues ? (
        <aside className="profile-content__souvenirs-sync-status">
          <AlertIcon size={20} />
          <div className="profile-content__souvenirs-sync-status-copy">
            <strong>{tSettings("souvenir_sync_status_title")}</strong>
            <span>
              {[
                syncStatus.pendingCount > 0
                  ? tSettings("souvenir_sync_pending", {
                      count: syncStatus.pendingCount,
                    })
                  : null,
                syncStatus.failedCount > 0
                  ? tSettings("souvenir_sync_failed", {
                      count: syncStatus.failedCount,
                    })
                  : null,
              ]
                .filter(Boolean)
                .join(" ")}
            </span>
          </div>
          <Button
            theme="outline"
            disabled={isRetryingSync}
            onClick={() => void handleRetrySync()}
          >
            <SyncIcon
              size={14}
              className={
                isRetryingSync
                  ? "profile-content__souvenirs-sync-status-icon--spinning"
                  : undefined
              }
            />
            {tSettings("retry_souvenir_sync")}
          </Button>
        </aside>
      ) : null}

      {achievements.length === 0 ? (
        <SouvenirsEmptyState
          isLoading={isLoading}
          hiddenReason={hiddenReason}
          isMe={isMe}
          hasActiveSubscription={hasActiveSubscription}
          isEnabled={isEnabled}
          onOpenSettings={onOpenSettings}
        />
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
                    disableNsfwAlert={disableNsfwAlert}
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
                    disableNsfwAlert={disableNsfwAlert}
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
