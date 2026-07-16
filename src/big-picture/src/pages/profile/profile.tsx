import "./profile.scss";

import {
  CheckCircleIcon,
  ClockIcon,
  GameControllerIcon,
  ProhibitIcon,
  SparkleIcon,
  SignOutIcon,
  TrophyIcon,
  UserCircleIcon,
  UserMinusIcon,
  UserPlusIcon,
  XCircleIcon,
} from "@phosphor-icons/react";
import type {
  Badge,
  FriendRequestAction,
  LibraryGame,
  ShopAssets,
  UserDetails,
  UserFriend,
  UserGame,
  UserProfile,
  UserStats,
} from "@types";
import {
  useCallback,
  useMemo,
  useState,
  type CSSProperties,
  type ReactNode,
  type SyntheticEvent,
} from "react";
import { useNavigate, useParams } from "react-router-dom";
import { useTranslation } from "react-i18next";
import {
  AnimatedHeroImage,
  Button,
  FocusItem,
  FocusCarousel,
  HorizontalFocusGroup,
  Tooltip,
  UserProfileAvatar,
  VerticalFocusGroup,
} from "../../components";
import { IS_DESKTOP } from "../../constants";
import {
  getBigPictureGameDetailsPath,
  getBigPictureGameAchievementsPath,
  formatRelativeDate,
  getGameIdentityKey,
  getGameLandscapeImageSource,
} from "../../helpers";
import { useHeroBackgroundLayers } from "../../components/pages/library/hero/use-hero-background-layers";
import { useFormat, useLibrary, useUserDetails } from "../../hooks";
import { BIG_PICTURE_SIDEBAR_PROFILE_ID } from "../../layout";
import type { FocusOverrides } from "../../services";
import {
  PROFILE_HERO_ACTIONS_REGION_ID,
  PROFILE_HERO_EXTERNAL_PRIMARY_ACTION_ID,
  PROFILE_HERO_EXTERNAL_SECONDARY_ACTION_ID,
  PROFILE_HERO_SIGN_OUT_BUTTON_ID,
  PROFILE_ACHIEVEMENTS_REGION_ID,
  PROFILE_FRIENDS_REGION_ID,
  PROFILE_FRIENDS_VIEW_ALL_ID,
  PROFILE_RECENT_ACTIVITY_REGION_ID,
  PROFILE_SOCIAL_REGION_ID,
  PROFILE_LIBRARY_CAROUSEL_REGION_ID,
  PROFILE_PAGE_REGION_ID,
  getProfileAchievementGameItemId,
  getProfileActivityItemId,
  getProfileFriendItemId,
} from "./navigation";
import {
  type ProfileRecentAchievementGroup,
  useExternalProfile,
  useProfileBadges,
  useProfileFriends,
  useProfileLibraryData,
  useRecentAchievements,
} from "./use-profile-data";

interface ProfileHeroUser {
  id: string;
  username: string;
  displayName: string;
  profileImageUrl: string | null;
  backgroundImageUrl: string | null;
  badges: string[];
  isOwnProfile: boolean;
}

type ProfileFavoriteGame = {
  title: string;
  iconUrl?: string | null;
  customIconUrl?: string | null;
  logoImageUrl?: string | null;
  customLogoImageUrl?: string | null;
  coverImageUrl?: string | null;
  libraryImageUrl?: string | null;
  playTimeInSeconds?: number;
  playTimeInMilliseconds?: number;
};

type ProfileActivityGame = {
  objectId: string;
  shop: ShopAssets["shop"];
  title: string;
  iconUrl?: string | null;
  coverImageUrl?: string | null;
  libraryImageUrl?: string | null;
  lastTimePlayed?: Date | string | null;
  playTimeInSeconds?: number;
  playTimeInMilliseconds?: number;
};

type ProfileLibraryCarouselGame = ShopAssets & {
  platform?: string | null;
  customIconUrl?: string | null;
  customHeroImageUrl?: string | null;
  customLogoImageUrl?: string | null;
  playTimeInMilliseconds?: number | null;
  achievementCount?: number | null;
  unlockedAchievementCount?: number | null;
};

type ProfileClassicsAssetFields = {
  platform?: string | null;
  customIconUrl?: string | null;
  customHeroImageUrl?: string | null;
  customLogoImageUrl?: string | null;
};

type ProfileFriendAction =
  | FriendRequestAction
  | "BLOCK"
  | "UNDO_FRIENDSHIP"
  | "SEND";

type ProfileHeroAction = {
  label: string;
  variant: "secondary" | "danger";
  icon: ReactNode;
  onClick: () => void;
};

const hydraIconUrl = new URL("../../assets/hydra-icon.svg", import.meta.url)
  .href;
const WEEKLY_BAR_PLACEHOLDER = [
  { day: "monday", label: "M", height: 0.62 },
  { day: "tuesday", label: "T", height: 0.14 },
  { day: "wednesday", label: "W", height: 0.36 },
  { day: "thursday", label: "T", height: 0.26 },
  { day: "friday", label: "F", height: 0.34 },
  { day: "saturday", label: "S", height: 0.42 },
  { day: "sunday", label: "S", height: 0.72 },
];
const LOCKED_ACHIEVEMENT_PREVIEW = {
  gameTitle: "Achievement preview",
  gameIconUrl:
    "https://cdn.cloudflare.steamstatic.com/steam/apps/2050650/capsule_184x69.jpg",
  newCount: 3,
  unlockedCount: 14,
  achievementCount: 35,
  achievements: [
    {
      displayName: "Nice One, Stranger!",
      description: "Complete a request for the Merchant.",
      imageUrl:
        "https://cdn.cloudflare.steamstatic.com/steam/apps/2050650/header.jpg",
      points: 760,
      earnedLabel: "Earned recently",
    },
    {
      displayName: "A Masterpiece",
      description: "Get the exclusive upgrade for a weapon.",
      imageUrl:
        "https://cdn.cloudflare.steamstatic.com/steam/apps/2050650/capsule_231x87.jpg",
      points: 1280,
      earnedLabel: "Earned 2 days ago",
    },
  ],
};

function getBasePath() {
  return IS_DESKTOP ? "/big-picture" : "";
}

function getProfileHeroUser(
  userDetails: UserDetails | null,
  externalProfile: UserProfile | null,
  routeUserId: string | undefined
): ProfileHeroUser | null {
  if (!routeUserId || routeUserId === userDetails?.id) {
    if (!userDetails) return null;

    return {
      id: userDetails.id,
      username: userDetails.username,
      displayName: userDetails.displayName,
      profileImageUrl: userDetails.profileImageUrl,
      backgroundImageUrl: userDetails.backgroundImageUrl,
      badges:
        externalProfile?.id === userDetails.id
          ? (externalProfile.badges ?? [])
          : [],
      isOwnProfile: true,
    };
  }

  if (!externalProfile) return null;

  return {
    id: externalProfile.id,
    username: "",
    displayName: externalProfile.displayName,
    profileImageUrl: externalProfile.profileImageUrl,
    backgroundImageUrl: externalProfile.backgroundImageUrl,
    badges: externalProfile.badges ?? [],
    isOwnProfile: false,
  };
}

function formatCompactNumber(value: number | null | undefined) {
  if (typeof value !== "number") return "--";

  return new Intl.NumberFormat("en", {
    notation: "compact",
    maximumFractionDigits: 1,
  }).format(value);
}

function formatHours(
  valueInSeconds: number | null | undefined,
  t: (key: string, options?: Record<string, unknown>) => string
) {
  if (typeof valueInSeconds !== "number") return "--";

  const hours = Math.floor(valueInSeconds / 3600);

  if (valueInSeconds > 0 && hours === 0) {
    const minutes = Math.max(1, Math.floor(valueInSeconds / 60));
    return t("compact_minutes", { count: minutes, ns: "big_picture" });
  }

  return t("compact_hours", { count: hours, ns: "big_picture" });
}

function formatAveragePlaytime(
  stats: UserStats | null,
  t: (key: string, options?: Record<string, unknown>) => string
) {
  if (!stats || stats.libraryCount <= 0) return "--";

  return formatHours(
    stats.totalPlayTimeInSeconds.value / stats.libraryCount,
    t
  );
}

function getFavoriteGameImage(game: ProfileFavoriteGame | null) {
  return (
    game?.customIconUrl ??
    game?.iconUrl ??
    game?.coverImageUrl ??
    game?.libraryImageUrl ??
    game?.customLogoImageUrl ??
    game?.logoImageUrl ??
    null
  );
}

function getFavoriteGamePlaytimeInSeconds(game: ProfileFavoriteGame | null) {
  if (!game) return null;

  if (typeof game.playTimeInSeconds === "number") {
    return game.playTimeInSeconds;
  }

  if (typeof game.playTimeInMilliseconds === "number") {
    return game.playTimeInMilliseconds / 1000;
  }

  return null;
}

function getDateTimestamp(value: Date | string | null | undefined) {
  if (!value) return null;

  const timestamp = new Date(value).getTime();

  return Number.isNaN(timestamp) ? null : timestamp;
}

function getActivityPlaytimeInMilliseconds(game: ProfileActivityGame) {
  if (typeof game.playTimeInMilliseconds === "number") {
    return game.playTimeInMilliseconds;
  }

  if (typeof game.playTimeInSeconds === "number") {
    return game.playTimeInSeconds * 1000;
  }

  return 0;
}

function getActivityLastPlayedLabel(
  game: ProfileActivityGame,
  language: string,
  t: (key: string, options?: Record<string, unknown>) => string
) {
  const relativeDate = formatRelativeDate(game.lastTimePlayed, {
    locale: language,
    fallback: t("recently_played_fallback", { ns: "big_picture" }),
  });

  return t("last_time_played", { period: relativeDate });
}

function getProfileActivityFocusId(game: ProfileActivityGame) {
  return getProfileActivityItemId(getProfileGameFocusKey(game));
}

function getRecentAchievementGameIcon(game: UserGame) {
  const classicsAssetFields = game as ProfileClassicsAssetFields;

  return (
    classicsAssetFields.customIconUrl ??
    game.iconUrl ??
    game.coverImageUrl ??
    null
  );
}

function getRecentAchievementGameKey(game: UserGame) {
  return getGameIdentityKey(game);
}

function getProfileGameFocusKey(game: {
  objectId: string;
  shop: ShopAssets["shop"];
}) {
  return getGameIdentityKey(game, {
    separator: "-",
  });
}

function getProfileAchievementFocusId(game: UserGame) {
  return getProfileAchievementGameItemId(getProfileGameFocusKey(game));
}

function getFriendGameIcon(game: UserFriend["currentGame"]) {
  return game?.iconUrl ?? game?.coverImageUrl ?? game?.libraryImageUrl ?? null;
}

function formatSessionDuration(valueInSeconds: number | null | undefined) {
  const safeValue = Math.max(0, valueInSeconds ?? 0);

  if (safeValue < 60) {
    const seconds = Math.max(1, Math.floor(safeValue));
    return `${seconds} ${seconds === 1 ? "second" : "seconds"} in session`;
  }

  const minutes = Math.floor(safeValue / 60);
  if (minutes < 60) {
    return `${minutes} ${minutes === 1 ? "minute" : "minutes"} in session`;
  }

  const hours = Math.floor(minutes / 60);
  return `${hours} ${hours === 1 ? "hour" : "hours"} in session`;
}

function getLibraryCarouselPlaytimeInMilliseconds(
  game: LibraryGame | UserGame
) {
  if (
    "playTimeInMilliseconds" in game &&
    typeof game.playTimeInMilliseconds === "number"
  ) {
    return game.playTimeInMilliseconds;
  }

  if (
    "playTimeInSeconds" in game &&
    typeof game.playTimeInSeconds === "number"
  ) {
    return game.playTimeInSeconds * 1000;
  }

  return null;
}

function toProfileLibraryCarouselGame(
  game: LibraryGame | UserGame
): ProfileLibraryCarouselGame {
  const classicsAssetFields = game as ProfileClassicsAssetFields;

  return {
    objectId: game.objectId,
    shop: game.shop,
    title: game.title,
    iconUrl: game.iconUrl ?? null,
    libraryHeroImageUrl: game.libraryHeroImageUrl ?? null,
    libraryImageUrl: game.libraryImageUrl ?? null,
    logoImageUrl: game.logoImageUrl ?? null,
    logoPosition: game.logoPosition ?? null,
    coverImageUrl: game.coverImageUrl ?? null,
    downloadSources: game.downloadSources ?? [],
    platform: classicsAssetFields.platform ?? null,
    customIconUrl: classicsAssetFields.customIconUrl ?? null,
    customHeroImageUrl: classicsAssetFields.customHeroImageUrl ?? null,
    customLogoImageUrl: classicsAssetFields.customLogoImageUrl ?? null,
    playTimeInMilliseconds: getLibraryCarouselPlaytimeInMilliseconds(game),
    achievementCount: game.achievementCount ?? null,
    unlockedAchievementCount: game.unlockedAchievementCount ?? null,
  };
}

function getProfileLibraryGameItemId(game: ShopAssets) {
  return `profile-library-game-${getGameIdentityKey(game, {
    separator: "-",
  })}`;
}

function getBlockUserAction(
  profile: UserProfile,
  onAction: (userId: string, action: ProfileFriendAction) => void
): ProfileHeroAction {
  return {
    label: "Block User",
    variant: "danger",
    icon: <ProhibitIcon size={20} />,
    onClick: () => onAction(profile.id, "BLOCK"),
  };
}

function getExternalProfileActions(
  profile: UserProfile | null,
  onAction: (userId: string, action: ProfileFriendAction) => void
): ProfileHeroAction[] {
  if (!profile) return [];

  if (profile.relation === null) {
    return [
      {
        label: "Add Friend",
        variant: "secondary",
        icon: <UserPlusIcon size={20} />,
        onClick: () => onAction(profile.id, "SEND"),
      },
      getBlockUserAction(profile, onAction),
    ];
  }

  const relation = profile.relation;

  if (relation.status === "ACCEPTED") {
    return [
      {
        label: "Remove Friend",
        variant: "secondary",
        icon: <UserMinusIcon size={20} />,
        onClick: () => onAction(profile.id, "UNDO_FRIENDSHIP"),
      },
      getBlockUserAction(profile, onAction),
    ];
  }

  if (relation.BId === profile.id) {
    return [
      {
        label: "Cancel Request",
        variant: "secondary",
        icon: <XCircleIcon size={20} />,
        onClick: () => onAction(relation.BId, "CANCEL"),
      },
    ];
  }

  return [
    {
      label: "Accept Request",
      variant: "secondary",
      icon: <CheckCircleIcon size={20} />,
      onClick: () => onAction(relation.AId, "ACCEPTED"),
    },
    {
      label: "Ignore Request",
      variant: "danger",
      icon: <XCircleIcon size={20} />,
      onClick: () => onAction(relation.AId, "REFUSED"),
    },
  ];
}

interface ProfileHeroProps {
  profileUser: ProfileHeroUser | null;
  visibleBadges: Badge[];
  externalActions: ProfileHeroAction[];
  isPerformingAction: boolean;
  isLoading: boolean;
  firstContentFocusId: string | null;
  onSignOut: () => void;
}

function getDownNavigationOverride(itemId: string | null): FocusOverrides {
  return {
    down: itemId
      ? {
          type: "item",
          itemId,
        }
      : {
          type: "block",
        },
  };
}

function ProfileHero({
  profileUser,
  visibleBadges,
  externalActions,
  isPerformingAction,
  isLoading,
  firstContentFocusId,
  onSignOut,
}: Readonly<ProfileHeroProps>) {
  const heroImageUrl = profileUser?.backgroundImageUrl ?? null;
  const { backgroundLayers, getLayerEventHandlers } =
    useHeroBackgroundLayers(heroImageUrl);
  const usernameLabel = profileUser?.username || profileUser?.id || "";
  const downNavigation = getDownNavigationOverride(firstContentFocusId);
  const signOutNavigationOverrides: FocusOverrides = {
    left: { type: "item", itemId: BIG_PICTURE_SIDEBAR_PROFILE_ID },
    right: { type: "block" },
    ...downNavigation,
  };
  const primaryNavigationOverrides: FocusOverrides = {
    left: { type: "item", itemId: BIG_PICTURE_SIDEBAR_PROFILE_ID },
    right:
      externalActions.length > 1
        ? {
            type: "item",
            itemId: PROFILE_HERO_EXTERNAL_SECONDARY_ACTION_ID,
          }
        : { type: "block" },
    ...downNavigation,
  };
  const secondaryNavigationOverrides: FocusOverrides = {
    left: {
      type: "item",
      itemId: PROFILE_HERO_EXTERNAL_PRIMARY_ACTION_ID,
    },
    right: { type: "block" },
    ...downNavigation,
  };

  return (
    <div className="profile-page__hero">
      <div className="profile-page__hero-media">
        {heroImageUrl ? (
          backgroundLayers.map((layer) => {
            const layerHandlers = getLayerEventHandlers(layer);

            return (
              <div
                key={layer.key}
                className={[
                  "profile-page__hero-bg-layer",
                  `profile-page__hero-bg-layer--${layer.role}`,
                  layer.isVisible ? "profile-page__hero-bg-layer--visible" : "",
                ]
                  .filter(Boolean)
                  .join(" ")}
                onTransitionEnd={layerHandlers.onTransitionEnd}
              >
                <AnimatedHeroImage
                  className="profile-page__hero-bg"
                  imageUrl={layer.imageUrl}
                  onLoad={layerHandlers.onLoad}
                  onError={layerHandlers.onError}
                />
              </div>
            );
          })
        ) : (
          <div className="profile-page__hero-bg profile-page__hero-bg--empty" />
        )}
        <div className="profile-page__hero-overlay" />
      </div>

      <div className="profile-page__hero-content">
        <div className="profile-page__identity">
          <UserProfileAvatar
            image={profileUser?.profileImageUrl}
            alt={profileUser?.displayName ?? "Profile"}
            className="profile-page__avatar"
            fallbackClassName="profile-page__avatar--fallback"
            width={128}
            height={128}
            iconSize={88}
          />

          <div className="profile-page__copy">
            <h1 className="profile-page__name">
              {profileUser?.displayName ??
                (isLoading ? "Loading profile..." : "Profile")}
            </h1>
            {usernameLabel ? (
              <p className="profile-page__username">{usernameLabel}</p>
            ) : null}
            {visibleBadges.length > 0 ? (
              <div className="profile-page__badges">
                {visibleBadges.map((badge) => (
                  <Tooltip
                    key={badge.name}
                    content={badge.title}
                    position="bottom"
                  >
                    <img
                      src={badge.badge.url}
                      alt={badge.name}
                      className="profile-page__badge"
                      width={24}
                      height={24}
                      draggable={false}
                    />
                  </Tooltip>
                ))}
              </div>
            ) : null}
          </div>
        </div>

        <ProfileHeroActions
          profileUser={profileUser}
          externalActions={externalActions}
          isPerformingAction={isPerformingAction}
          signOutNavigationOverrides={signOutNavigationOverrides}
          primaryNavigationOverrides={primaryNavigationOverrides}
          secondaryNavigationOverrides={secondaryNavigationOverrides}
          onSignOut={onSignOut}
        />

        {!profileUser && !isLoading ? (
          <div className="profile-page__empty">
            <UserCircleIcon size={32} />
            <span>Profile not found</span>
          </div>
        ) : null}
      </div>
    </div>
  );
}

interface ProfileHeroActionsProps {
  profileUser: ProfileHeroUser | null;
  externalActions: ProfileHeroAction[];
  isPerformingAction: boolean;
  signOutNavigationOverrides: FocusOverrides;
  primaryNavigationOverrides: FocusOverrides;
  secondaryNavigationOverrides: FocusOverrides;
  onSignOut: () => void;
}

function ProfileHeroActions({
  profileUser,
  externalActions,
  isPerformingAction,
  signOutNavigationOverrides,
  primaryNavigationOverrides,
  secondaryNavigationOverrides,
  onSignOut,
}: Readonly<ProfileHeroActionsProps>) {
  if (profileUser?.isOwnProfile) {
    return (
      <HorizontalFocusGroup
        regionId={PROFILE_HERO_ACTIONS_REGION_ID}
        className="profile-page__actions"
      >
        <Button
          variant="danger"
          icon={<SignOutIcon size={20} />}
          focusId={PROFILE_HERO_SIGN_OUT_BUTTON_ID}
          focusNavigationOverrides={signOutNavigationOverrides}
          onClick={onSignOut}
        >
          Sign Out
        </Button>
      </HorizontalFocusGroup>
    );
  }

  if (externalActions.length === 0) return null;

  return (
    <HorizontalFocusGroup
      regionId={PROFILE_HERO_ACTIONS_REGION_ID}
      className="profile-page__actions"
    >
      {externalActions.map((action, index) => {
        const isPrimary = index === 0;

        return (
          <Button
            key={action.label}
            variant={action.variant}
            icon={action.icon}
            focusId={
              isPrimary
                ? PROFILE_HERO_EXTERNAL_PRIMARY_ACTION_ID
                : PROFILE_HERO_EXTERNAL_SECONDARY_ACTION_ID
            }
            focusNavigationOverrides={
              isPrimary
                ? primaryNavigationOverrides
                : secondaryNavigationOverrides
            }
            loading={isPerformingAction}
            onClick={action.onClick}
          >
            {action.label}
          </Button>
        );
      })}
    </HorizontalFocusGroup>
  );
}

interface ProfileStatsProps {
  userStats: UserStats | null;
  favoriteGame: ProfileFavoriteGame | null;
}

function ProfileStats({
  userStats,
  favoriteGame,
}: Readonly<ProfileStatsProps>) {
  const { t } = useTranslation(["game_details", "big_picture"]);
  const favoriteGameImageUrl = getFavoriteGameImage(favoriteGame);
  const favoriteGamePlaytimeInSeconds =
    getFavoriteGamePlaytimeInSeconds(favoriteGame);

  return (
    <section className="profile-page__stats-section">
      <div className="profile-page__stats-grid">
        <article className="profile-page__stat-card profile-page__stat-card--hours">
          <div className="profile-page__stat-main profile-page__stat-main--hours">
            <div className="profile-page__stat-value">
              <ClockIcon size={36} />
              <span>
                {formatHours(userStats?.totalPlayTimeInSeconds.value, t)}
              </span>
            </div>

            <div
              className="profile-page__weekly-bars"
              aria-label="Weekly playtime data unavailable"
            >
              <div className="profile-page__weekly-bars-track">
                {WEEKLY_BAR_PLACEHOLDER.map(({ day, height }) => (
                  <span
                    key={day}
                    className="profile-page__weekly-bar"
                    style={
                      {
                        "--profile-weekly-bar-height": `${Math.round(height * 100)}%`,
                      } as CSSProperties
                    }
                  />
                ))}
              </div>
              <div className="profile-page__weekly-labels">
                {WEEKLY_BAR_PLACEHOLDER.map(({ day, label }) => (
                  <span key={day}>{label}</span>
                ))}
              </div>
            </div>
          </div>
          <div className="profile-page__stat-label">Hours Played</div>
        </article>

        <ProfileStatPair
          leftIcon={<GameControllerIcon size={36} />}
          leftValue={formatCompactNumber(userStats?.libraryCount)}
          leftLabel="Games Played"
          rightIcon={<ClockIcon size={36} />}
          rightValue={formatAveragePlaytime(userStats, t)}
          rightLabel="Avg. Playtime"
        />

        <article className="profile-page__stat-card profile-page__stat-card--favorite">
          <div className="profile-page__favorite-game-media">
            <div className="profile-page__favorite-game-image-frame">
              {favoriteGameImageUrl ? (
                <img
                  src={favoriteGameImageUrl}
                  alt={favoriteGame?.title ?? "Favorite game"}
                  draggable={false}
                />
              ) : (
                <SparkleIcon size={42} />
              )}
            </div>
          </div>

          <div className="profile-page__favorite-game-panel">
            <div className="profile-page__favorite-game-copy">
              <h2>{favoriteGame?.title ?? "--"}</h2>
              <p>
                {favoriteGame
                  ? t("play_time", {
                      amount: formatHours(favoriteGamePlaytimeInSeconds, t),
                    })
                  : "--"}
              </p>
            </div>
            <div className="profile-page__stat-label">Favorite Game</div>
          </div>
        </article>

        <ProfileStatPair
          leftIcon={<TrophyIcon size={36} />}
          leftValue={formatCompactNumber(userStats?.unlockedAchievementSum)}
          leftLabel="Achievements"
          rightIcon={
            <img
              src={hydraIconUrl}
              alt=""
              className="profile-page__stat-hydra-icon"
              draggable={false}
            />
          }
          rightValue={formatCompactNumber(
            userStats?.achievementsPointsEarnedSum?.value
          )}
          rightLabel="Earned Points"
        />
      </div>
    </section>
  );
}

interface ProfileStatPairProps {
  leftIcon: ReactNode;
  leftValue: string;
  leftLabel: string;
  rightIcon: ReactNode;
  rightValue: string;
  rightLabel: string;
}

function ProfileStatPair({
  leftIcon,
  leftValue,
  leftLabel,
  rightIcon,
  rightValue,
  rightLabel,
}: Readonly<ProfileStatPairProps>) {
  return (
    <div className="profile-page__stat-pair">
      <article className="profile-page__stat-card profile-page__stat-card--pair-left">
        <div className="profile-page__stat-main">
          <div className="profile-page__stat-value">
            {leftIcon}
            <span>{leftValue}</span>
          </div>
        </div>
        <div className="profile-page__stat-label">{leftLabel}</div>
      </article>

      <article className="profile-page__stat-card profile-page__stat-card--pair-right">
        <div className="profile-page__stat-main">
          <div className="profile-page__stat-value">
            {rightIcon}
            <span>{rightValue}</span>
          </div>
        </div>
        <div className="profile-page__stat-label">{rightLabel}</div>
      </article>
    </div>
  );
}

interface ProfileActivityProps {
  games: ProfileActivityGame[];
  firstFocusId: string | null;
  lastFocusId: string | null;
  heroActionsFocusId: string | null;
  downFocusId: string | null;
  onActivate: (game: ProfileActivityGame) => void;
}

function ProfileActivity({
  games,
  firstFocusId,
  lastFocusId,
  heroActionsFocusId,
  downFocusId,
  onActivate,
}: Readonly<ProfileActivityProps>) {
  return (
    <section className="profile-page__activity-section">
      <div className="profile-page__activity-header">
        <h2>Recent Activity</h2>
      </div>

      {games.length > 0 ? (
        <VerticalFocusGroup
          regionId={PROFILE_RECENT_ACTIVITY_REGION_ID}
          className="profile-page__activity-list"
          style={{ gap: "calc(var(--spacing-unit) * 4)" }}
        >
          {games.map((game) => (
            <ProfileActivityItem
              key={`${game.title}-${game.lastTimePlayed ?? "recent"}`}
              game={game}
              firstFocusId={firstFocusId}
              lastFocusId={lastFocusId}
              heroActionsFocusId={heroActionsFocusId}
              downFocusId={downFocusId}
              onActivate={onActivate}
            />
          ))}
        </VerticalFocusGroup>
      ) : (
        <p className="profile-page__activity-empty">No recent activity</p>
      )}
    </section>
  );
}

interface ProfileActivityItemProps extends Omit<ProfileActivityProps, "games"> {
  game: ProfileActivityGame;
}

function ProfileActivityItem({
  game,
  firstFocusId,
  lastFocusId,
  heroActionsFocusId,
  downFocusId,
  onActivate,
}: Readonly<ProfileActivityItemProps>) {
  const { t, i18n } = useTranslation(["game_details", "big_picture"]);
  const { formatPlayTime } = useFormat();
  const language = i18n.resolvedLanguage ?? i18n.language ?? "en";
  const imageUrl = getGameLandscapeImageSource(game);
  const focusId = getProfileActivityFocusId(game);
  const navigationOverrides: FocusOverrides = {};

  if (focusId === firstFocusId) {
    navigationOverrides.up = heroActionsFocusId
      ? { type: "item", itemId: heroActionsFocusId }
      : { type: "block" };
  }

  if (focusId === lastFocusId) {
    navigationOverrides.down = downFocusId
      ? { type: "item", itemId: downFocusId }
      : { type: "block" };
  }

  return (
    <FocusItem
      id={focusId}
      actions={{ primary: () => onActivate(game) }}
      navigationOverrides={navigationOverrides}
      asChild
    >
      <button
        type="button"
        className="profile-page__activity-item"
        onClick={() => onActivate(game)}
      >
        <div className="profile-page__activity-media">
          {imageUrl ? (
            <img src={imageUrl} alt={game.title} draggable={false} />
          ) : null}
        </div>

        <div className="profile-page__activity-copy">
          <h3>{game.title}</h3>
          <p>{getActivityLastPlayedLabel(game, language, t)}</p>
        </div>

        <span className="profile-page__activity-playtime">
          {t("play_time", {
            amount: formatPlayTime(
              getActivityPlaytimeInMilliseconds(game) / 1000
            ),
          })}
        </span>
      </button>
    </FocusItem>
  );
}

interface ProfileLibraryProps {
  games: ProfileLibraryCarouselGame[];
  totalGames: number;
  upFocusId: string | null;
  downFocusId: string | null;
  onActivate: (game: ProfileLibraryCarouselGame) => void;
}

function ProfileLibrary({
  games,
  totalGames,
  upFocusId,
  downFocusId,
  onActivate,
}: Readonly<ProfileLibraryProps>) {
  return (
    <div className="profile-page__library-carousel">
      <FocusCarousel
        title="Library"
        headerMeta={formatCompactNumber(totalGames)}
        cardMode="library"
        cardVariant="vertical"
        games={games}
        regionId={PROFILE_LIBRARY_CAROUSEL_REGION_ID}
        getItemId={getProfileLibraryGameItemId}
        getItemNavigationOverrides={() => ({
          up: upFocusId
            ? { type: "item", itemId: upFocusId }
            : { type: "block" },
          down: downFocusId
            ? { type: "item", itemId: downFocusId }
            : { type: "block" },
        })}
        onItemActivate={onActivate}
        showRightFade
      />
    </div>
  );
}

interface ProfileAchievementsProps {
  groups: ProfileRecentAchievementGroup[];
  unlockedAchievementCount: number | null | undefined;
  canView: boolean;
  isOwnProfile: boolean;
  firstFocusId: string | null;
  lastFocusId: string | null;
  socialUpFocusId: string | null;
  firstFriendFocusId: string | null;
  onActivate: (game: UserGame) => void;
}

function ProfileAchievements({
  groups,
  unlockedAchievementCount,
  canView,
  isOwnProfile,
  firstFocusId,
  lastFocusId,
  socialUpFocusId,
  firstFriendFocusId,
  onActivate,
}: Readonly<ProfileAchievementsProps>) {
  return (
    <VerticalFocusGroup
      regionId={PROFILE_ACHIEVEMENTS_REGION_ID}
      className="profile-page__achievements-section"
      style={{ gap: "calc(var(--spacing-unit) * 5)" }}
    >
      <div className="profile-page__section-header">
        <h2>Recent Achievements</h2>
        <span>{formatCompactNumber(unlockedAchievementCount)}</span>
      </div>

      <ProfileAchievementsContent
        groups={groups}
        canView={canView}
        isOwnProfile={isOwnProfile}
        firstFocusId={firstFocusId}
        lastFocusId={lastFocusId}
        socialUpFocusId={socialUpFocusId}
        firstFriendFocusId={firstFriendFocusId}
        onActivate={onActivate}
      />
    </VerticalFocusGroup>
  );
}

type ProfileAchievementsContentProps = Omit<
  ProfileAchievementsProps,
  "unlockedAchievementCount"
>;

function ProfileAchievementsContent({
  groups,
  canView,
  isOwnProfile,
  firstFocusId,
  lastFocusId,
  socialUpFocusId,
  firstFriendFocusId,
  onActivate,
}: Readonly<ProfileAchievementsContentProps>) {
  if (!canView) return <LockedAchievements />;

  if (groups.length === 0) {
    return (
      <p className="profile-page__activity-empty">No recent achievements</p>
    );
  }

  return (
    <div className="profile-page__achievement-groups">
      {groups.map((group) => (
        <ProfileAchievementGroup
          key={getRecentAchievementGameKey(group.game)}
          group={group}
          isOwnProfile={isOwnProfile}
          firstFocusId={firstFocusId}
          lastFocusId={lastFocusId}
          socialUpFocusId={socialUpFocusId}
          firstFriendFocusId={firstFriendFocusId}
          onActivate={onActivate}
        />
      ))}
    </div>
  );
}

interface ProfileAchievementGroupProps {
  group: ProfileRecentAchievementGroup;
  isOwnProfile: boolean;
  firstFocusId: string | null;
  lastFocusId: string | null;
  socialUpFocusId: string | null;
  firstFriendFocusId: string | null;
  onActivate: (game: UserGame) => void;
}

function ProfileAchievementGroup({
  group,
  isOwnProfile,
  firstFocusId,
  lastFocusId,
  socialUpFocusId,
  firstFriendFocusId,
  onActivate,
}: Readonly<ProfileAchievementGroupProps>) {
  const focusId = getProfileAchievementFocusId(group.game);
  const content = <ProfileAchievementGroupContent group={group} />;

  if (!isOwnProfile) {
    return <div className="profile-page__achievement-group">{content}</div>;
  }

  const navigationOverrides: FocusOverrides = {
    right: firstFriendFocusId
      ? { type: "item", itemId: firstFriendFocusId }
      : undefined,
  };

  if (focusId === firstFocusId) {
    navigationOverrides.up = socialUpFocusId
      ? { type: "item", itemId: socialUpFocusId }
      : { type: "block" };
  }

  if (focusId === lastFocusId) {
    navigationOverrides.down = { type: "block" };
  }

  return (
    <FocusItem
      id={focusId}
      actions={{ primary: () => onActivate(group.game) }}
      navigationOverrides={navigationOverrides}
      asChild
    >
      <button
        type="button"
        className="profile-page__achievement-group"
        onClick={() => onActivate(group.game)}
      >
        {content}
      </button>
    </FocusItem>
  );
}

function ProfileAchievementGroupContent({
  group,
}: Readonly<{ group: ProfileRecentAchievementGroup }>) {
  const { t, i18n } = useTranslation(["game_details", "big_picture"]);
  const language = i18n.resolvedLanguage ?? i18n.language ?? "en";
  const gameIconUrl = getRecentAchievementGameIcon(group.game);

  return (
    <>
      <div className="profile-page__achievement-game-header">
        <div className="profile-page__achievement-game-copy">
          {gameIconUrl ? (
            <img src={gameIconUrl} alt="" draggable={false} />
          ) : (
            <TrophyIcon size={20} />
          )}
          <span>{group.game.title}</span>
        </div>

        <div className="profile-page__achievement-game-meta">
          <span>({group.newCount} new)</span>
          <strong>
            {group.game.unlockedAchievementCount ?? 0}/
            {group.game.achievementCount ?? 0}
          </strong>
        </div>
      </div>

      <div className="profile-page__achievement-list">
        {group.achievements.map((achievement) => (
          <div
            key={`${group.game.objectId}-${achievement.key}`}
            className="profile-page__achievement-row"
          >
            <img src={achievement.icon} alt="" draggable={false} />

            <div className="profile-page__achievement-copy">
              <h3>{achievement.displayName}</h3>
              {achievement.description ? (
                <p>{achievement.description}</p>
              ) : null}
            </div>

            <div className="profile-page__achievement-meta">
              <span>
                Earned{" "}
                {formatRelativeDate(achievement.unlockTime, {
                  locale: language,
                  fallback: t("recently_played_fallback", {
                    ns: "big_picture",
                  }),
                })}
              </span>
            </div>
          </div>
        ))}
      </div>
    </>
  );
}

function hideBrokenPreviewImage(event: SyntheticEvent<HTMLImageElement>) {
  event.currentTarget.style.opacity = "0";
}

function LockedAchievements() {
  return (
    <div className="profile-page__achievements-lock-frame">
      <div
        className="profile-page__achievement-groups profile-page__achievement-groups--locked"
        aria-hidden
      >
        <div className="profile-page__achievement-group profile-page__achievement-group--locked-preview">
          <div className="profile-page__achievement-game-header">
            <div className="profile-page__achievement-game-copy">
              <span className="profile-page__locked-preview-game-icon">
                <img
                  src={LOCKED_ACHIEVEMENT_PREVIEW.gameIconUrl}
                  alt=""
                  draggable={false}
                  onError={hideBrokenPreviewImage}
                />
              </span>
              <span className="profile-page__locked-preview-game-title">
                {LOCKED_ACHIEVEMENT_PREVIEW.gameTitle}
              </span>
            </div>

            <div className="profile-page__achievement-game-meta">
              <span>({LOCKED_ACHIEVEMENT_PREVIEW.newCount} new)</span>
              <strong>
                {LOCKED_ACHIEVEMENT_PREVIEW.unlockedCount}/
                {LOCKED_ACHIEVEMENT_PREVIEW.achievementCount}
              </strong>
            </div>
          </div>

          <div className="profile-page__achievement-list">
            {LOCKED_ACHIEVEMENT_PREVIEW.achievements.map((achievement) => (
              <div
                key={achievement.displayName}
                className="profile-page__achievement-row"
              >
                <span className="profile-page__locked-preview-achievement-icon">
                  <img
                    src={achievement.imageUrl}
                    alt=""
                    draggable={false}
                    onError={hideBrokenPreviewImage}
                  />
                </span>

                <div className="profile-page__achievement-copy profile-page__locked-preview-achievement-copy">
                  <h3>{achievement.displayName}</h3>
                  <p>{achievement.description}</p>
                </div>

                <div className="profile-page__achievement-meta">
                  <strong>+{achievement.points} pts.</strong>
                  <span>{achievement.earnedLabel}</span>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>

      <div className="profile-page__achievements-lock-overlay">
        <SparkleIcon size={24} weight="fill" />
        <p>
          This user is required to have Hydra Cloud in order to display
          achievements in his profile.
        </p>
      </div>
    </div>
  );
}

interface ProfileFriendsProps {
  friends: UserFriend[];
  totalFriends: number;
  firstFocusId: string | null;
  lastFocusId: string | null;
  socialUpFocusId: string | null;
  firstAchievementFocusId: string | null;
  showViewAll: boolean;
  onOpenFriend: (friendId: string) => void;
  onViewAll: () => void;
}

function ProfileFriends({
  friends,
  totalFriends,
  firstFocusId,
  lastFocusId,
  socialUpFocusId,
  firstAchievementFocusId,
  showViewAll,
  onOpenFriend,
  onViewAll,
}: Readonly<ProfileFriendsProps>) {
  return (
    <VerticalFocusGroup
      regionId={PROFILE_FRIENDS_REGION_ID}
      className="profile-page__friends-section"
      style={{ gap: "calc(var(--spacing-unit) * 5)" }}
    >
      <div className="profile-page__section-header">
        <h2>Friends</h2>
        <span>{formatCompactNumber(totalFriends)}</span>
      </div>

      {friends.length > 0 ? (
        <div className="profile-page__friends-list">
          {friends.map((friend) => (
            <ProfileFriend
              key={friend.id}
              friend={friend}
              firstFocusId={firstFocusId}
              lastFocusId={lastFocusId}
              socialUpFocusId={socialUpFocusId}
              firstAchievementFocusId={firstAchievementFocusId}
              showViewAll={showViewAll}
              onOpen={onOpenFriend}
            />
          ))}
          {showViewAll ? (
            <ProfileFriendsViewAll
              lastFocusId={lastFocusId}
              firstAchievementFocusId={firstAchievementFocusId}
              onViewAll={onViewAll}
            />
          ) : null}
        </div>
      ) : (
        <p className="profile-page__activity-empty">No friends</p>
      )}
    </VerticalFocusGroup>
  );
}

interface ProfileFriendProps {
  friend: UserFriend;
  firstFocusId: string | null;
  lastFocusId: string | null;
  socialUpFocusId: string | null;
  firstAchievementFocusId: string | null;
  showViewAll: boolean;
  onOpen: (friendId: string) => void;
}

function ProfileFriend({
  friend,
  firstFocusId,
  lastFocusId,
  socialUpFocusId,
  firstAchievementFocusId,
  showViewAll,
  onOpen,
}: Readonly<ProfileFriendProps>) {
  const focusId = getProfileFriendItemId(friend.id);
  const gameIconUrl = getFriendGameIcon(friend.currentGame);
  const navigationOverrides: FocusOverrides = {
    left: firstAchievementFocusId
      ? { type: "item", itemId: firstAchievementFocusId }
      : undefined,
  };

  if (focusId === firstFocusId) {
    navigationOverrides.up = socialUpFocusId
      ? { type: "item", itemId: socialUpFocusId }
      : { type: "block" };
  }

  if (focusId === lastFocusId) {
    navigationOverrides.down = showViewAll
      ? { type: "item", itemId: PROFILE_FRIENDS_VIEW_ALL_ID }
      : { type: "block" };
  }

  return (
    <FocusItem
      id={focusId}
      actions={{ primary: () => onOpen(friend.id) }}
      navigationOverrides={navigationOverrides}
      asChild
    >
      <button
        type="button"
        className="profile-page__friend-row"
        onClick={() => onOpen(friend.id)}
      >
        <div className="profile-page__friend-profile">
          {friend.profileImageUrl ? (
            <img src={friend.profileImageUrl} alt="" draggable={false} />
          ) : (
            <UserCircleIcon size={56} />
          )}
          <span>{friend.displayName}</span>
        </div>

        {friend.currentGame ? (
          <div className="profile-page__friend-game">
            <div className="profile-page__friend-game-title">
              {gameIconUrl ? (
                <img src={gameIconUrl} alt="" draggable={false} />
              ) : null}
              <span>{friend.currentGame.title}</span>
            </div>
            <span>
              {formatSessionDuration(
                friend.currentGame.sessionDurationInSeconds
              )}
            </span>
          </div>
        ) : null}
      </button>
    </FocusItem>
  );
}

interface ProfileFriendsViewAllProps {
  lastFocusId: string | null;
  firstAchievementFocusId: string | null;
  onViewAll: () => void;
}

function ProfileFriendsViewAll({
  lastFocusId,
  firstAchievementFocusId,
  onViewAll,
}: Readonly<ProfileFriendsViewAllProps>) {
  return (
    <FocusItem
      id={PROFILE_FRIENDS_VIEW_ALL_ID}
      actions={{ primary: onViewAll }}
      navigationOverrides={{
        up: lastFocusId ? { type: "item", itemId: lastFocusId } : undefined,
        left: firstAchievementFocusId
          ? { type: "item", itemId: firstAchievementFocusId }
          : undefined,
        down: { type: "block" },
      }}
      asChild
    >
      <button
        type="button"
        className="profile-page__friends-view-all"
        onClick={onViewAll}
      >
        View All
      </button>
    </FocusItem>
  );
}

function getLocalFavoriteGame(library: LibraryGame[], isOwnProfile: boolean) {
  if (!isOwnProfile) return null;

  return (
    [...library]
      .filter((game) => (game.playTimeInMilliseconds ?? 0) > 0)
      .sort(
        (a, b) =>
          (b.playTimeInMilliseconds ?? 0) - (a.playTimeInMilliseconds ?? 0)
      )[0] ?? null
  );
}

function getRemoteFavoriteGame(games: UserGame[]) {
  return (
    [...games]
      .filter((game) => (game.playTimeInSeconds ?? 0) > 0)
      .sort(
        (a, b) => (b.playTimeInSeconds ?? 0) - (a.playTimeInSeconds ?? 0)
      )[0] ?? null
  );
}

function getRecentGames<T extends ProfileActivityGame>(games: T[], take = 3) {
  return [...games]
    .filter((game) => getDateTimestamp(game.lastTimePlayed) !== null)
    .sort(
      (a, b) =>
        (getDateTimestamp(b.lastTimePlayed) ?? 0) -
        (getDateTimestamp(a.lastTimePlayed) ?? 0)
    )
    .slice(0, take);
}

function getProfileRecentActivityGames(
  isOwnProfile: boolean,
  localGames: LibraryGame[],
  remoteGames: UserGame[],
  remoteFallbackGames: UserGame[]
): ProfileActivityGame[] {
  if (isOwnProfile) return localGames;
  if (remoteGames.length > 0) return remoteGames;
  return remoteFallbackGames;
}

interface ProfileGames {
  favoriteGame: ProfileFavoriteGame | null;
  recentActivityGames: ProfileActivityGame[];
  libraryCarouselGames: ProfileLibraryCarouselGame[];
}

function useProfileGames(
  profileUser: ProfileHeroUser | null,
  isOwnProfile: boolean,
  library: LibraryGame[],
  remoteLibraryGames: UserGame[],
  remoteFavoriteGame: UserGame | null,
  remoteRecentActivityGames: UserGame[]
): ProfileGames {
  const localFavoriteGame = useMemo(
    () => getLocalFavoriteGame(library, isOwnProfile),
    [isOwnProfile, library]
  );
  const remoteFavoriteFallback = useMemo(
    () => getRemoteFavoriteGame(remoteLibraryGames),
    [remoteLibraryGames]
  );
  const localRecentGames = useMemo(
    () => (isOwnProfile ? getRecentGames(library) : []),
    [isOwnProfile, library]
  );
  const remoteRecentFallback = useMemo(
    () => getRecentGames(remoteLibraryGames),
    [remoteLibraryGames]
  );
  const recentActivityGames = getProfileRecentActivityGames(
    Boolean(profileUser?.isOwnProfile),
    localRecentGames,
    remoteRecentActivityGames,
    remoteRecentFallback
  );
  const libraryCarouselGames = useMemo(() => {
    const sourceGames = profileUser?.isOwnProfile
      ? library
      : remoteLibraryGames;
    return sourceGames.map(toProfileLibraryCarouselGame);
  }, [library, profileUser?.isOwnProfile, remoteLibraryGames]);

  return {
    favoriteGame: profileUser?.isOwnProfile
      ? localFavoriteGame
      : (remoteFavoriteGame ?? remoteFavoriteFallback),
    recentActivityGames,
    libraryCarouselGames,
  };
}

interface ProfileNavigation {
  firstActivityFocusId: string | null;
  lastActivityFocusId: string | null;
  firstAchievementFocusId: string | null;
  lastAchievementFocusId: string | null;
  firstFriendFocusId: string | null;
  lastFriendFocusId: string | null;
  firstContentFocusId: string | null;
  activityDownFocusId: string | null;
  libraryDownFocusId: string | null;
  heroActionsFocusId: string | null;
  libraryUpFocusId: string | null;
  socialUpFocusId: string | null;
}

interface ProfileNavigationInput {
  profileUser: ProfileHeroUser | null;
  recentActivityGames: ProfileActivityGame[];
  libraryCarouselGames: ProfileLibraryCarouselGame[];
  recentAchievementGroups: ProfileRecentAchievementGroup[];
  friends: UserFriend[];
  canFocusRecentAchievements: boolean;
}

type ProfileFocusIds = Pick<
  ProfileNavigation,
  | "firstActivityFocusId"
  | "lastActivityFocusId"
  | "firstAchievementFocusId"
  | "lastAchievementFocusId"
  | "firstFriendFocusId"
  | "lastFriendFocusId"
> & {
  firstLibraryFocusId: string | null;
};

function getFirstItem<T>(items: T[]) {
  return items[0] ?? null;
}

function getLastItem<T>(items: T[]) {
  return items.at(-1) ?? null;
}

function getHeroActionsFocusId(profileUser: ProfileHeroUser | null) {
  if (!profileUser) return null;

  return profileUser.isOwnProfile
    ? PROFILE_HERO_SIGN_OUT_BUTTON_ID
    : PROFILE_HERO_EXTERNAL_PRIMARY_ACTION_ID;
}

function getProfileFocusIds({
  recentActivityGames,
  libraryCarouselGames,
  recentAchievementGroups,
  friends,
  canFocusRecentAchievements,
}: Omit<ProfileNavigationInput, "profileUser">) {
  const firstActivity = getFirstItem(recentActivityGames);
  const lastActivity = getLastItem(recentActivityGames);
  const firstLibrary = getFirstItem(libraryCarouselGames);
  const focusableAchievements = canFocusRecentAchievements
    ? recentAchievementGroups
    : [];
  const firstAchievement = getFirstItem(focusableAchievements);
  const lastAchievement = getLastItem(focusableAchievements);
  const firstFriend = getFirstItem(friends);
  const lastFriend = getLastItem(friends);

  return {
    firstActivityFocusId: firstActivity
      ? getProfileActivityFocusId(firstActivity)
      : null,
    lastActivityFocusId: lastActivity
      ? getProfileActivityFocusId(lastActivity)
      : null,
    firstLibraryFocusId: firstLibrary
      ? getProfileLibraryGameItemId(firstLibrary)
      : null,
    firstAchievementFocusId: firstAchievement
      ? getProfileAchievementFocusId(firstAchievement.game)
      : null,
    lastAchievementFocusId: lastAchievement
      ? getProfileAchievementFocusId(lastAchievement.game)
      : null,
    firstFriendFocusId: firstFriend
      ? getProfileFriendItemId(firstFriend.id)
      : null,
    lastFriendFocusId: lastFriend
      ? getProfileFriendItemId(lastFriend.id)
      : null,
  } satisfies ProfileFocusIds;
}

function getProfileNavigation({
  profileUser,
  recentActivityGames,
  libraryCarouselGames,
  recentAchievementGroups,
  friends,
  canFocusRecentAchievements,
}: ProfileNavigationInput): ProfileNavigation {
  const focusIds = getProfileFocusIds({
    recentActivityGames,
    libraryCarouselGames,
    recentAchievementGroups,
    friends,
    canFocusRecentAchievements,
  });
  const {
    firstActivityFocusId,
    lastActivityFocusId,
    firstLibraryFocusId,
    firstAchievementFocusId,
    lastAchievementFocusId,
    firstFriendFocusId,
    lastFriendFocusId,
  } = focusIds;
  const firstSocialFocusId = firstAchievementFocusId ?? firstFriendFocusId;
  const heroActionsFocusId = getHeroActionsFocusId(profileUser);

  return {
    firstActivityFocusId,
    lastActivityFocusId,
    firstAchievementFocusId,
    lastAchievementFocusId,
    firstFriendFocusId,
    lastFriendFocusId,
    firstContentFocusId:
      firstActivityFocusId ?? firstLibraryFocusId ?? firstSocialFocusId,
    activityDownFocusId: firstLibraryFocusId ?? firstSocialFocusId,
    libraryDownFocusId: firstSocialFocusId,
    heroActionsFocusId,
    libraryUpFocusId: lastActivityFocusId ?? heroActionsFocusId,
    socialUpFocusId:
      firstLibraryFocusId ?? lastActivityFocusId ?? heroActionsFocusId,
  };
}

interface ProfileContentProps {
  userId?: string;
}

function ProfileContent({ userId }: Readonly<ProfileContentProps>) {
  const navigate = useNavigate();
  const {
    userDetails,
    hasActiveSubscription,
    signOut,
    sendFriendRequest,
    updateFriendRequestState,
    undoFriendship,
    blockUser,
  } = useUserDetails();
  const { library } = useLibrary();
  const [isPerformingProfileAction, setIsPerformingProfileAction] =
    useState(false);

  const targetUserId = userId ?? userDetails?.id;
  const isOwnProfileTarget = !userId || userId === userDetails?.id;
  const badges = useProfileBadges();
  const {
    externalProfile,
    isLoading: isLoadingExternalProfile,
    reload: reloadExternalProfile,
  } = useExternalProfile(targetUserId);
  const targetHasActiveSubscription = isOwnProfileTarget
    ? hasActiveSubscription
    : Boolean(externalProfile?.hasActiveSubscription);
  const {
    userStats,
    remoteLibraryGames,
    remoteLibraryTotalCount,
    remoteFavoriteGame,
    remoteRecentActivityGames,
  } = useProfileLibraryData(targetUserId, isOwnProfileTarget);
  const {
    friends,
    totalFriends,
    showAll: showAllFriends,
  } = useProfileFriends(targetUserId, isOwnProfileTarget);
  const recentAchievementGroups = useRecentAchievements(
    targetUserId,
    isOwnProfileTarget,
    targetHasActiveSubscription
  );

  const profileUser = useMemo(
    () => getProfileHeroUser(userDetails, externalProfile, userId),
    [externalProfile, userDetails, userId]
  );

  const handleSignOut = useCallback(async () => {
    await signOut();
    navigate(getBasePath() || "/");
  }, [navigate, signOut]);

  const handleFriendAction = useCallback(
    async (actionUserId: string, action: ProfileFriendAction) => {
      if (!profileUser || profileUser.isOwnProfile) return;

      setIsPerformingProfileAction(true);

      try {
        if (action === "SEND") {
          await sendFriendRequest(profileUser.id);
        } else if (action === "UNDO_FRIENDSHIP") {
          await undoFriendship(actionUserId);
        } else if (action === "BLOCK") {
          await blockUser(actionUserId);
          navigate(-1);
          return;
        } else {
          await updateFriendRequestState(actionUserId, action);
        }

        await reloadExternalProfile(profileUser.id);
      } catch {
        // Keep the current profile visible if the relationship action fails.
      } finally {
        setIsPerformingProfileAction(false);
      }
    },
    [
      blockUser,
      navigate,
      profileUser,
      reloadExternalProfile,
      sendFriendRequest,
      undoFriendship,
      updateFriendRequestState,
    ]
  );

  const isLoading =
    isLoadingExternalProfile || (!profileUser && Boolean(targetUserId));
  const visibleBadges = useMemo(() => {
    if (!profileUser?.badges.length) return [];

    return profileUser.badges
      .map((badgeName) => badges.find((badge) => badge.name === badgeName))
      .filter((badge): badge is Badge => Boolean(badge));
  }, [badges, profileUser?.badges]);
  const { favoriteGame, recentActivityGames, libraryCarouselGames } =
    useProfileGames(
      profileUser,
      isOwnProfileTarget,
      library,
      remoteLibraryGames,
      remoteFavoriteGame,
      remoteRecentActivityGames
    );
  const totalLibraryGames = profileUser?.isOwnProfile
    ? library.length
    : (userStats?.libraryCount ?? remoteLibraryTotalCount);
  const canViewRecentAchievements =
    Boolean(profileUser) && targetHasActiveSubscription;
  const canFocusRecentAchievements =
    canViewRecentAchievements && Boolean(profileUser?.isOwnProfile);
  const {
    firstActivityFocusId,
    lastActivityFocusId,
    firstAchievementFocusId,
    lastAchievementFocusId,
    firstFriendFocusId,
    lastFriendFocusId,
    firstContentFocusId,
    activityDownFocusId,
    libraryDownFocusId,
    heroActionsFocusId,
    libraryUpFocusId,
    socialUpFocusId,
  } = getProfileNavigation({
    profileUser,
    recentActivityGames,
    libraryCarouselGames,
    recentAchievementGroups,
    friends,
    canFocusRecentAchievements,
  });
  const showFriendsViewAll = totalFriends > friends.length;
  const externalProfileActions = useMemo<ProfileHeroAction[]>(() => {
    if (!profileUser || profileUser.isOwnProfile || !externalProfile) return [];
    return getExternalProfileActions(
      externalProfile,
      (actionUserId, action) => {
        handleFriendAction(actionUserId, action).catch(() => {});
      }
    );
  }, [externalProfile, handleFriendAction, profileUser]);

  return (
    <VerticalFocusGroup regionId={PROFILE_PAGE_REGION_ID} asChild>
      <section className="profile-page">
        <ProfileHero
          profileUser={profileUser}
          visibleBadges={visibleBadges}
          externalActions={externalProfileActions}
          isPerformingAction={isPerformingProfileAction}
          isLoading={isLoading}
          firstContentFocusId={firstContentFocusId}
          onSignOut={() => {
            handleSignOut().catch(() => {});
          }}
        />

        {profileUser ? (
          <div className="profile-page__sections">
            <ProfileStats userStats={userStats} favoriteGame={favoriteGame} />

            <ProfileActivity
              games={recentActivityGames}
              firstFocusId={firstActivityFocusId}
              lastFocusId={lastActivityFocusId}
              heroActionsFocusId={heroActionsFocusId}
              downFocusId={activityDownFocusId}
              onActivate={(game) =>
                navigate(getBigPictureGameDetailsPath(game))
              }
            />

            <ProfileLibrary
              games={libraryCarouselGames}
              totalGames={totalLibraryGames}
              upFocusId={libraryUpFocusId}
              downFocusId={libraryDownFocusId}
              onActivate={(game) =>
                navigate(getBigPictureGameDetailsPath(game))
              }
            />

            <HorizontalFocusGroup
              regionId={PROFILE_SOCIAL_REGION_ID}
              className="profile-page__social-section"
              asChild
            >
              <section className="profile-page__social-section">
                <ProfileAchievements
                  groups={recentAchievementGroups}
                  unlockedAchievementCount={userStats?.unlockedAchievementSum}
                  canView={canViewRecentAchievements}
                  isOwnProfile={profileUser.isOwnProfile}
                  firstFocusId={firstAchievementFocusId}
                  lastFocusId={lastAchievementFocusId}
                  socialUpFocusId={socialUpFocusId}
                  firstFriendFocusId={firstFriendFocusId}
                  onActivate={(game) =>
                    navigate(getBigPictureGameAchievementsPath(game))
                  }
                />

                <ProfileFriends
                  friends={friends}
                  totalFriends={totalFriends}
                  firstFocusId={firstFriendFocusId}
                  lastFocusId={lastFriendFocusId}
                  socialUpFocusId={socialUpFocusId}
                  firstAchievementFocusId={firstAchievementFocusId}
                  showViewAll={showFriendsViewAll}
                  onOpenFriend={(friendId) =>
                    navigate(`${getBasePath()}/profile/${friendId}`)
                  }
                  onViewAll={showAllFriends}
                />
              </section>
            </HorizontalFocusGroup>
          </div>
        ) : null}
      </section>
    </VerticalFocusGroup>
  );
}

export default function Profile() {
  const { userId } = useParams();

  return <ProfileContent key={userId ?? "current-user"} userId={userId} />;
}
