import "./profile.scss";

import {
  ClockIcon,
  GameController,
  PencilSimpleIcon,
  SparkleIcon,
  SignOutIcon,
  TrophyIcon,
  UserCircleIcon,
} from "@phosphor-icons/react";
import type {
  Badge,
  LibraryGame,
  UserDetails,
  UserGame,
  UserLibraryResponse,
  UserProfile,
  UserStats,
} from "@types";
import { useEffect, useMemo, useState, type CSSProperties } from "react";
import { useNavigate, useParams } from "react-router-dom";
import {
  Button,
  HorizontalFocusGroup,
  Tooltip,
  VerticalFocusGroup,
} from "../../components";
import { IS_DESKTOP } from "../../constants";
import { useLibrary, useUserDetails } from "../../hooks";
import { BIG_PICTURE_SIDEBAR_PROFILE_ID } from "../../layout";
import type { FocusOverrides } from "../../services";
import {
  PROFILE_HERO_ACTIONS_REGION_ID,
  PROFILE_HERO_EDIT_BUTTON_ID,
  PROFILE_HERO_SIGN_OUT_BUTTON_ID,
  PROFILE_PAGE_REGION_ID,
} from "./navigation";

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

const PROFILE_AVATAR_FALLBACK =
  "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='160' height='160' viewBox='0 0 160 160'%3E%3Crect width='160' height='160' rx='24' fill='%2320242d'/%3E%3Ccircle cx='80' cy='60' r='30' fill='%23838383'/%3E%3Cpath d='M34 142c9-36 35-54 46-54s37 18 46 54' fill='%23838383'/%3E%3C/svg%3E";
const hydraIconUrl = new URL("../../assets/hydra-icon.svg", import.meta.url)
  .href;
const WEEKLY_BAR_PLACEHOLDER = [0.62, 0.14, 0.36, 0.26, 0.34, 0.42, 0.72];
const WEEKDAY_LABELS = ["M", "S", "T", "W", "T", "F", "S"];

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
        externalProfile?.id === userDetails.id ? externalProfile.badges : [],
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
    badges: externalProfile.badges,
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

function formatHours(valueInSeconds: number | null | undefined) {
  if (typeof valueInSeconds !== "number") return "--";

  const hours = Math.floor(valueInSeconds / 3600);

  if (valueInSeconds > 0 && hours === 0) {
    const minutes = Math.max(1, Math.floor(valueInSeconds / 60));
    return `${minutes}min`;
  }

  return `${hours}hs`;
}

function formatAveragePlaytime(stats: UserStats | null) {
  if (!stats || stats.libraryCount <= 0) return "--";

  return formatHours(stats.totalPlayTimeInSeconds.value / stats.libraryCount);
}

function getFavoriteGameImage(game: ProfileFavoriteGame | null) {
  return (
    game?.iconUrl ??
    game?.customIconUrl ??
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

export default function Profile() {
  const { userId } = useParams();
  const navigate = useNavigate();
  const { userDetails } = useUserDetails();
  const { library } = useLibrary();
  const [externalProfile, setExternalProfile] = useState<UserProfile | null>(
    null
  );
  const [badges, setBadges] = useState<Badge[]>([]);
  const [userStats, setUserStats] = useState<UserStats | null>(null);
  const [remoteFavoriteGame, setRemoteFavoriteGame] =
    useState<UserGame | null>(null);
  const [isLoadingExternalProfile, setIsLoadingExternalProfile] =
    useState(false);

  useEffect(() => {
    globalThis.window.electron.hydraApi
      .get<Badge[]>("/badges?locale=en", { needsAuth: false })
      .then(setBadges)
      .catch(() => {
        setBadges([]);
      });
  }, []);

  const targetUserId = userId ?? userDetails?.id;
  const isOwnProfileTarget = !userId || userId === userDetails?.id;

  useEffect(() => {
    if (!targetUserId) {
      setExternalProfile(null);
      return;
    }

    let isMounted = true;
    setIsLoadingExternalProfile(true);

    globalThis.window.electron.hydraApi
      .get<UserProfile>(`/users/${targetUserId}`)
      .then((profile) => {
        if (isMounted) setExternalProfile(profile);
      })
      .catch(() => {
        if (isMounted) setExternalProfile(null);
      })
      .finally(() => {
        if (isMounted) setIsLoadingExternalProfile(false);
      });

    return () => {
      isMounted = false;
    };
  }, [targetUserId]);

  useEffect(() => {
    if (!targetUserId) {
      setUserStats(null);
      setRemoteFavoriteGame(null);
      return;
    }

    let isMounted = true;

    globalThis.window.electron.hydraApi
      .get<UserStats>(`/users/${targetUserId}/stats`)
      .then((stats) => {
        if (isMounted) setUserStats(stats);
      })
      .catch(() => {
        if (isMounted) setUserStats(null);
      });

    if (isOwnProfileTarget) {
      setRemoteFavoriteGame(null);
    } else {
      globalThis.window.electron.hydraApi
        .get<UserLibraryResponse>(
          `/users/${targetUserId}/library?take=1&skip=0&sortBy=playtime`
        )
        .then((response) => {
          if (isMounted) setRemoteFavoriteGame(response.library[0] ?? null);
        })
        .catch(() => {
          if (isMounted) setRemoteFavoriteGame(null);
        });
    }

    return () => {
      isMounted = false;
    };
  }, [isOwnProfileTarget, targetUserId]);

  const profileUser = useMemo(
    () => getProfileHeroUser(userDetails, externalProfile, userId),
    [externalProfile, userDetails, userId]
  );

  const editNavigationOverrides: FocusOverrides = {
    left: {
      type: "item",
      itemId: BIG_PICTURE_SIDEBAR_PROFILE_ID,
    },
    right: {
      type: "item",
      itemId: PROFILE_HERO_SIGN_OUT_BUTTON_ID,
    },
    down: {
      type: "block",
    },
  };
  const signOutNavigationOverrides: FocusOverrides = {
    left: {
      type: "item",
      itemId: PROFILE_HERO_EDIT_BUTTON_ID,
    },
    right: {
      type: "block",
    },
    down: {
      type: "block",
    },
  };

  const handleEditProfile = () => {
    navigate(`${getBasePath()}/settings?tab=account-privacy`);
  };

  const handleSignOut = async () => {
    await globalThis.window.electron.signOut();
    navigate(getBasePath() || "/");
  };

  const isLoading =
    isLoadingExternalProfile || (!profileUser && Boolean(targetUserId));
  const heroImageUrl =
    profileUser?.backgroundImageUrl ?? profileUser?.profileImageUrl ?? null;
  const usernameLabel = profileUser?.username || profileUser?.id || "";
  const visibleBadges = useMemo(() => {
    if (!profileUser?.badges.length) return [];

    return profileUser.badges
      .map((badgeName) => badges.find((badge) => badge.name === badgeName))
      .filter((badge): badge is Badge => Boolean(badge));
    }, [badges, profileUser?.badges]);
  const localFavoriteGame = useMemo<LibraryGame | null>(() => {
    if (!isOwnProfileTarget) return null;

    return [...library]
      .filter((game) => (game.playTimeInMilliseconds ?? 0) > 0)
      .sort(
        (a, b) =>
          (b.playTimeInMilliseconds ?? 0) - (a.playTimeInMilliseconds ?? 0)
      )[0] ?? null;
  }, [isOwnProfileTarget, library]);
  const favoriteGame: ProfileFavoriteGame | null = profileUser?.isOwnProfile
    ? localFavoriteGame
    : remoteFavoriteGame;
  const favoriteGameImageUrl = getFavoriteGameImage(favoriteGame);
  const favoriteGamePlaytimeInSeconds =
    getFavoriteGamePlaytimeInSeconds(favoriteGame);

  return (
    <VerticalFocusGroup regionId={PROFILE_PAGE_REGION_ID} asChild>
      <section className="profile-page">
        <div className="profile-page__hero">
          <div className="profile-page__hero-media">
            {heroImageUrl ? (
              <img
                src={heroImageUrl}
                alt=""
                className="profile-page__hero-bg"
                draggable={false}
              />
            ) : (
              <div className="profile-page__hero-bg profile-page__hero-bg--empty" />
            )}

            <div className="profile-page__hero-overlay" />
          </div>

          <div className="profile-page__hero-content">
            <div className="profile-page__identity">
              <img
                src={profileUser?.profileImageUrl ?? PROFILE_AVATAR_FALLBACK}
                alt={profileUser?.displayName ?? "Profile"}
                className="profile-page__avatar"
                draggable={false}
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

            {profileUser?.isOwnProfile ? (
              <HorizontalFocusGroup
                regionId={PROFILE_HERO_ACTIONS_REGION_ID}
                className="profile-page__actions"
              >
                <Button
                  variant="secondary"
                  icon={<PencilSimpleIcon size={20} />}
                  focusId={PROFILE_HERO_EDIT_BUTTON_ID}
                  focusNavigationOverrides={editNavigationOverrides}
                  onClick={handleEditProfile}
                >
                  Edit Profile
                </Button>

                <Button
                  variant="danger"
                  icon={<SignOutIcon size={20} />}
                  focusId={PROFILE_HERO_SIGN_OUT_BUTTON_ID}
                  focusNavigationOverrides={signOutNavigationOverrides}
                  onClick={() => {
                    void handleSignOut();
                  }}
                >
                  Sign Out
                </Button>
              </HorizontalFocusGroup>
            ) : null}

            {!profileUser && !isLoading ? (
              <div className="profile-page__empty">
                <UserCircleIcon size={32} />
                <span>Profile not found</span>
              </div>
            ) : null}
          </div>
        </div>

        {profileUser ? (
          <section className="profile-page__stats-section">
            <div className="profile-page__stats-grid">
              <article className="profile-page__stat-card profile-page__stat-card--hours">
                <div className="profile-page__stat-main profile-page__stat-main--hours">
                  <div className="profile-page__stat-value">
                    <ClockIcon size={36} />
                    <span>
                      {formatHours(userStats?.totalPlayTimeInSeconds.value)}
                    </span>
                  </div>

                  <div
                    className="profile-page__weekly-bars"
                    aria-label="Weekly playtime data unavailable"
                  >
                    <div className="profile-page__weekly-bars-track">
                      {WEEKLY_BAR_PLACEHOLDER.map((height, index) => (
                        <span
                          key={`${WEEKDAY_LABELS[index]}-${index}`}
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
                      {WEEKDAY_LABELS.map((label, index) => (
                        <span key={`${label}-${index}`}>{label}</span>
                      ))}
                    </div>
                  </div>
                </div>
                <div className="profile-page__stat-label">Hours Played</div>
              </article>

              <div className="profile-page__stat-pair">
                <article className="profile-page__stat-card profile-page__stat-card--pair-left">
                  <div className="profile-page__stat-main">
                    <div className="profile-page__stat-value">
                      <GameController size={36} />
                      <span>
                        {formatCompactNumber(userStats?.libraryCount)}
                      </span>
                    </div>
                  </div>
                  <div className="profile-page__stat-label">Games Played</div>
                </article>

                <article className="profile-page__stat-card profile-page__stat-card--pair-right">
                  <div className="profile-page__stat-main">
                    <div className="profile-page__stat-value">
                      <ClockIcon size={36} />
                      <span>{formatAveragePlaytime(userStats)}</span>
                    </div>
                  </div>
                  <div className="profile-page__stat-label">Avg. Playtime</div>
                </article>
              </div>

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
                        ? `${formatHours(favoriteGamePlaytimeInSeconds)} played`
                        : "--"}
                    </p>
                  </div>

                  <div className="profile-page__stat-label">Favorite Game</div>
                </div>
              </article>

              <div className="profile-page__stat-pair">
                <article className="profile-page__stat-card profile-page__stat-card--pair-left">
                  <div className="profile-page__stat-main">
                    <div className="profile-page__stat-value">
                      <TrophyIcon size={36} />
                      <span>
                        {formatCompactNumber(userStats?.unlockedAchievementSum)}
                      </span>
                    </div>
                  </div>
                  <div className="profile-page__stat-label">Achievements</div>
                </article>

                <article className="profile-page__stat-card profile-page__stat-card--pair-right">
                  <div className="profile-page__stat-main">
                    <div className="profile-page__stat-value">
                      <img
                        src={hydraIconUrl}
                        alt=""
                        className="profile-page__stat-hydra-icon"
                        draggable={false}
                      />
                      <span>
                        {formatCompactNumber(
                          userStats?.achievementsPointsEarnedSum?.value
                        )}
                      </span>
                    </div>
                  </div>
                  <div className="profile-page__stat-label">Earned Points</div>
                </article>
              </div>
            </div>
          </section>
        ) : null}
      </section>
    </VerticalFocusGroup>
  );
}
