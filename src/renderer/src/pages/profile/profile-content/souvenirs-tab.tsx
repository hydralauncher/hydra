import { useEffect, useMemo, useState } from "react";
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
  TrashIcon,
  XIcon,
} from "@primer/octicons-react";
import { FilterDropdown, type FilterDropdownOption } from "./filter-dropdown";
import type {
  AchievementSouvenirSyncItem,
  AchievementSouvenirSyncStatus,
  ProfileSouvenir,
  ProfileVisibility,
  SouvenirsHiddenReason,
  SouvenirSort,
} from "@types";
import { useDate, useToast } from "@renderer/hooks";
import {
  getPrimarySouvenirAchievement,
  getSouvenirKey,
  getSouvenirSyncErrorTranslationKeys,
  getSouvenirVisualVariant,
  shouldShowSouvenirContentWarning,
} from "@shared";
import InfiniteScroll from "react-infinite-scroll-component";
import { Button, Link } from "@renderer/components";
import {
  buildGameDetailsPath,
  readStoredSouvenirGrouping,
  readStoredSouvenirSort,
  type SouvenirGrouping,
} from "@renderer/helpers";
import HydraIcon from "@renderer/assets/icons/hydra.svg?react";
import { useSubscription } from "@renderer/hooks/use-subscription";
import { LockedProfile } from "./locked-profile";
import { SouvenirSyncCleanupModal } from "./souvenir-sync-cleanup-modal";
import "./profile-content.scss";

const souvenirKey = (souvenir: ProfileSouvenir) => getSouvenirKey(souvenir.id);
const LIKE_ANIMATION_DURATION_MS = 400;
const SOUVENIR_VISIBILITY_ACKNOWLEDGEMENT_KEY =
  "souvenir-visibility-acknowledged";

const getSouvenirVisibilityAcknowledgementKey = (userId: string) =>
  `${SOUVENIR_VISIBILITY_ACKNOWLEDGEMENT_KEY}:${userId}`;

const getSouvenirCardClassName = (
  visualVariant: ReturnType<typeof getSouvenirVisualVariant>
) =>
  visualVariant
    ? `profile-content__souvenir profile-content__souvenir--${visualVariant}`
    : "profile-content__souvenir";

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
  const [failedAchievementIconUrl, setFailedAchievementIconUrl] = useState<
    string | null
  >(null);
  const [failedGameIconUrl, setFailedGameIconUrl] = useState<string | null>(
    null
  );
  const [isLikeAnimating, setIsLikeAnimating] = useState(false);
  const hasThumbnail = Boolean(
    achievement.imageUrl && achievement.imageUrl !== failedThumbnailUrl
  );
  const hasAchievementIcon = Boolean(
    primaryAchievement.achievementIcon &&
      primaryAchievement.achievementIcon !== failedAchievementIconUrl
  );
  const hasGameIcon = Boolean(
    achievement.gameIconUrl && achievement.gameIconUrl !== failedGameIconUrl
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
        {!hasThumbnail ? (
          <span className="profile-content__souvenir-image-placeholder">
            <ImageIcon size={32} />
          </span>
        ) : null}

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
          {hasAchievementIcon ? (
            <img
              className="profile-content__souvenir-achievement-icon-image"
              src={primaryAchievement.achievementIcon ?? undefined}
              alt=""
              loading="lazy"
              onError={() =>
                setFailedAchievementIconUrl(primaryAchievement.achievementIcon)
              }
            />
          ) : (
            <TrophyIcon size={16} />
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
            {showGame ? (
              <Link
                className="profile-content__souvenir-game-link"
                to={buildGameDetailsPath({
                  shop: achievement.shop,
                  objectId: achievement.objectId,
                  title: achievement.gameTitle ?? t("unknown_game"),
                })}
              >
                <span className="profile-content__souvenir-game-icon">
                  {hasGameIcon ? (
                    <img
                      className="profile-content__souvenir-game-icon-image"
                      src={achievement.gameIconUrl ?? undefined}
                      alt=""
                      loading="lazy"
                      onError={() =>
                        setFailedGameIconUrl(achievement.gameIconUrl)
                      }
                    />
                  ) : (
                    <ImageIcon size={12} />
                  )}
                </span>

                <span className="profile-content__souvenir-game-name">
                  {achievement.gameTitle ?? t("unknown_game")}
                </span>
              </Link>
            ) : (
              formatDistance(
                new Date(primaryAchievement.unlockTime),
                new Date(),
                {
                  addSuffix: true,
                }
              )
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
  const [failedGameIconUrl, setFailedGameIconUrl] = useState<string | null>(
    null
  );

  const [{ gameTitle, gameIconUrl }] = achievements;
  const hasGameIcon = Boolean(gameIconUrl && gameIconUrl !== failedGameIconUrl);
  const resolvedGameTitle = gameTitle ?? t("unknown_game");

  return (
    <div className="profile-content__souvenirs-group">
      <div className="profile-content__souvenirs-group-header">
        <button
          type="button"
          className="profile-content__souvenirs-group-toggle"
          onClick={() => setIsExpanded(!isExpanded)}
          aria-expanded={isExpanded}
        >
          {isExpanded ? <ChevronDownIcon /> : <ChevronRightIcon />}

          <span className="profile-content__souvenirs-group-icon">
            {hasGameIcon ? (
              <img
                className="profile-content__souvenirs-group-icon-image"
                src={gameIconUrl ?? undefined}
                alt=""
                loading="lazy"
                onError={() => setFailedGameIconUrl(gameIconUrl)}
              />
            ) : (
              <ImageIcon size={14} />
            )}
          </span>

          <span className="profile-content__souvenirs-group-title">
            {resolvedGameTitle}
          </span>
        </button>

        <span className="profile-content__souvenirs-group-count">
          {achievements.length}
        </span>
      </div>

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
  hasReachedLimit: boolean;
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
  hasReachedLimit,
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
  const [grouping, setGrouping] = useState<SouvenirGrouping>(
    readStoredSouvenirGrouping
  );
  const [sortBy, setSortBy] = useState<SouvenirSort>(readStoredSouvenirSort);
  const [isPrivacyNoticeVisible, setIsPrivacyNoticeVisible] = useState(false);
  const [syncStatus, setSyncStatus] = useState<AchievementSouvenirSyncStatus>({
    pendingCount: 0,
    failedCount: 0,
    errorCodes: [],
  });
  const [isRetryingSync, setIsRetryingSync] = useState(false);
  const [isLoadingSyncDetails, setIsLoadingSyncDetails] = useState(false);
  const [isCleaningSync, setIsCleaningSync] = useState(false);
  const [cleanupItems, setCleanupItems] = useState<
    AchievementSouvenirSyncItem[]
  >([]);
  const [isCleanupModalVisible, setIsCleanupModalVisible] = useState(false);
  const { showErrorToast, showSuccessToast } = useToast();
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

    if (visibility === "PUBLIC") {
      localStorage.setItem(storageKey, visibility);
      setIsPrivacyNoticeVisible(false);
      return;
    }

    setIsPrivacyNoticeVisible(
      !acknowledgedVisibility || acknowledgedVisibility !== visibility
    );
  }, [isMe, userId, visibility]);

  useEffect(() => {
    if (!isMe) {
      setSyncStatus({ pendingCount: 0, failedCount: 0, errorCodes: [] });
      return;
    }

    void window.electron.getAchievementSouvenirSyncStatus().then(setSyncStatus);
    const unsubscribeStatus =
      window.electron.onAchievementSouvenirSyncStatus(setSyncStatus);
    const unsubscribeCompleted =
      window.electron.onAchievementSouvenirSyncCompleted(() => {
        void onReload(sortBy);
      });
    const unsubscribeMissing =
      window.electron.onAchievementSouvenirScreenshotsMissing((count) => {
        showErrorToast(
          tSettings("souvenir_sync_screenshot_missing", { count })
        );
      });

    return () => {
      unsubscribeStatus();
      unsubscribeCompleted();
      unsubscribeMissing();
    };
  }, [isMe, onReload, showErrorToast, sortBy, tSettings]);

  const handleRetrySync = async () => {
    if (isRetryingSync) return;

    setIsRetryingSync(true);
    try {
      const result = await window.electron.retryAchievementSouvenirSync();
      setSyncStatus(result.status);

      const remainingCount =
        result.status.pendingCount + result.status.failedCount;
      if (result.missingScreenshotCount > 0) {
        return;
      }

      if (remainingCount === 0) {
        showSuccessToast(tSettings("souvenir_sync_retry_succeeded"));
      } else {
        showErrorToast(
          tSettings("souvenir_sync_retry_incomplete", {
            count: remainingCount,
          })
        );
      }
    } catch {
      const currentStatus = await window.electron
        .getAchievementSouvenirSyncStatus()
        .catch(() => null);
      if (currentStatus) setSyncStatus(currentStatus);
      showErrorToast(tSettings("souvenir_sync_retry_failed"));
    } finally {
      setIsRetryingSync(false);
    }
  };

  const handleOpenCleanup = async () => {
    if (isLoadingSyncDetails) return;

    setIsLoadingSyncDetails(true);
    try {
      const details = await window.electron.getAchievementSouvenirSyncDetails();
      setSyncStatus(details.status);
      setCleanupItems(details.items);
      setIsCleanupModalVisible(details.items.length > 0);
    } catch {
      showErrorToast(tSettings("souvenir_sync_cleanup_load_failed"));
    } finally {
      setIsLoadingSyncDetails(false);
    }
  };

  const handleCleanupSync = async () => {
    if (isCleaningSync) return;

    setIsCleaningSync(true);
    try {
      const result = await window.electron.cleanupAchievementSouvenirSync();
      setSyncStatus(result.status);
      setIsCleanupModalVisible(false);
      setCleanupItems([]);

      if (result.failedFilePaths.length > 0) {
        showErrorToast(
          tSettings("souvenir_sync_cleanup_files_failed", {
            count: result.failedFilePaths.length,
          })
        );
      } else {
        showSuccessToast(
          tSettings("souvenir_sync_cleanup_succeeded", {
            count: result.deletedCount,
          })
        );
      }
    } catch {
      showErrorToast(tSettings("souvenir_sync_cleanup_failed"));
    } finally {
      setIsCleaningSync(false);
    }
  };

  const hasSyncIssues =
    syncStatus.pendingCount > 0 || syncStatus.failedCount > 0;
  const syncMessages = [
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
    ...getSouvenirSyncErrorTranslationKeys(syncStatus.errorCodes).map((key) =>
      tSettings(key)
    ),
  ].filter((message): message is string => Boolean(message));

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
        <aside className="profile-content__souvenirs-notice">
          <span className="profile-content__souvenirs-notice-icon">
            <PrivacyIcon size={18} />
          </span>
          <div className="profile-content__souvenirs-notice-copy">
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

      {isMe && hasReachedLimit ? (
        <aside className="profile-content__souvenirs-notice">
          <span className="profile-content__souvenirs-notice-icon">
            <AlertIcon size={18} />
          </span>
          <div className="profile-content__souvenirs-notice-copy">
            <strong>{t("souvenir_limit_reached_title")}</strong>
            <span>{t("souvenir_limit_reached_description")}</span>
          </div>
        </aside>
      ) : null}

      {hasSyncIssues ? (
        <aside className="profile-content__souvenirs-sync-status">
          <AlertIcon size={20} />
          <div className="profile-content__souvenirs-sync-status-copy">
            <strong>{tSettings("souvenir_sync_status_title")}</strong>
            <span>{syncMessages.join(" ")}</span>
          </div>
          <div className="profile-content__souvenirs-sync-status-actions">
            {syncStatus.pendingCount > 0 ? (
              <Button
                theme="outline"
                disabled={isRetryingSync || isLoadingSyncDetails}
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
            ) : null}
            <Button
              theme="outline"
              disabled={isRetryingSync || isLoadingSyncDetails}
              onClick={() => void handleOpenCleanup()}
            >
              <TrashIcon size={14} />
              {tSettings("clean_up_souvenir_sync")}
            </Button>
          </div>
        </aside>
      ) : null}

      <SouvenirSyncCleanupModal
        visible={isCleanupModalVisible}
        items={cleanupItems}
        isDeleting={isCleaningSync}
        onClose={() => {
          if (!isCleaningSync) setIsCleanupModalVisible(false);
        }}
        onConfirm={() => void handleCleanupSync()}
      />

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
              onChange={(value) => {
                setGrouping(value);
                localStorage.setItem("profile-souvenir-grouping", value);
              }}
            />

            <FilterDropdown
              placeholder={t("sort_by")}
              value={sortBy}
              options={sortOptions}
              onChange={(value) => {
                setSortBy(value);
                localStorage.setItem("profile-souvenir-sort-by", value);
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
