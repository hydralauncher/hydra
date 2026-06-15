import "./profile.scss";

import {
  CheckCircleIcon,
  ClockIcon,
  GameController,
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
  ComparedAchievements,
  FriendRequestAction,
  LibraryGame,
  ShopAssets,
  UserDetails,
  UserFriend,
  UserFriends,
  UserAchievement,
  UserGame,
  UserLibraryResponse,
  UserProfile,
  UserStats,
} from "@types";
import {
  useEffect,
  useMemo,
  useState,
  type CSSProperties,
  type ReactNode,
} from "react";
import { useNavigate, useParams } from "react-router-dom";
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
  formatPlayedTime,
  formatRelativeDate,
  getGameIdentityKey,
  getGameLandscapeImageSource,
} from "../../helpers";
import { useHeroBackgroundLayers } from "../../components/pages/library/hero/use-hero-background-layers";
import { useLibrary, useUserDetails } from "../../hooks";
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

type ProfileComparedAchievement = ComparedAchievements["achievements"][number];

type ProfileRecentAchievement = {
  key: string;
  icon: string;
  displayName: string;
  description: string;
  unlockTime: number;
};

type ProfileRecentAchievementGroup = {
  game: UserGame;
  newCount: number;
  achievements: ProfileRecentAchievement[];
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
const WEEKLY_BAR_PLACEHOLDER = [0.62, 0.14, 0.36, 0.26, 0.34, 0.42, 0.72];
const WEEKDAY_LABELS = ["M", "S", "T", "W", "T", "F", "S"];
const PROFILE_RECENT_ACHIEVEMENT_GROUP_LIMIT = 2;
const PROFILE_RECENT_ACHIEVEMENTS_PER_GAME = 2;
const PROFILE_RECENT_ACHIEVEMENT_LIBRARY_TAKE = 12;
const PROFILE_FRIENDS_LIMIT = 5;
const PROFILE_REMOTE_LIBRARY_PAGE_SIZE = 12;
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

function getActivityLastPlayedLabel(game: ProfileActivityGame) {
  return `Last played ${formatRelativeDate(game.lastTimePlayed, {
    fallback: "recently",
  })}`;
}

function getProfileActivityFocusId(game: ProfileActivityGame) {
  return getProfileActivityItemId(getProfileGameFocusKey(game));
}

function getComparedAchievement(
  achievement: ProfileComparedAchievement
): ProfileRecentAchievement | null {
  if (
    !achievement.targetStat.unlocked ||
    typeof achievement.targetStat.unlockTime !== "number"
  ) {
    return null;
  }

  return {
    key: `${achievement.displayName}-${achievement.targetStat.unlockTime}`,
    icon: achievement.icon,
    displayName: achievement.displayName,
    description: achievement.description,
    unlockTime: achievement.targetStat.unlockTime,
  };
}

function getOwnUnlockedAchievement(
  achievement: UserAchievement
): ProfileRecentAchievement | null {
  if (!achievement.unlocked || typeof achievement.unlockTime !== "number") {
    return null;
  }

  return {
    key: `${achievement.displayName}-${achievement.unlockTime}`,
    icon: achievement.icon,
    displayName: achievement.displayName,
    description: achievement.description ?? "",
    unlockTime: achievement.unlockTime,
  };
}

function getRecentAchievementGameIcon(game: UserGame) {
  const classicsAssetFields = game as ProfileClassicsAssetFields;

  return (
    game.iconUrl ??
    classicsAssetFields.customIconUrl ??
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

function buildRecentAchievementGroups(
  achievementsByGame: Array<{
    game: UserGame;
    achievements: ProfileRecentAchievement[];
  }>
): ProfileRecentAchievementGroup[] {
  const gameByKey = new Map(
    achievementsByGame.map(({ game }) => [
      getRecentAchievementGameKey(game),
      game,
    ])
  );
  const selectedGameKeys = new Set<string>();
  const timeline = achievementsByGame
    .flatMap(({ game, achievements }) => {
      const gameKey = getRecentAchievementGameKey(game);

      return achievements.map((achievement) => ({
        gameKey,
        achievement,
      }));
    })
    .sort((a, b) => b.achievement.unlockTime - a.achievement.unlockTime);
  const groups: ProfileRecentAchievementGroup[] = [];

  for (let index = 0; index < timeline.length; ) {
    const currentGameKey = timeline[index].gameKey;
    const block: ProfileRecentAchievement[] = [];

    while (
      index < timeline.length &&
      timeline[index].gameKey === currentGameKey
    ) {
      block.push(timeline[index].achievement);
      index += 1;
    }

    const game = gameByKey.get(currentGameKey);

    if (!game || selectedGameKeys.has(currentGameKey) || block.length === 0) {
      continue;
    }

    selectedGameKeys.add(currentGameKey);
    groups.push({
      game,
      newCount: block.length,
      achievements: block.slice(0, PROFILE_RECENT_ACHIEVEMENTS_PER_GAME),
    });

    if (groups.length >= PROFILE_RECENT_ACHIEVEMENT_GROUP_LIMIT) break;
  }

  return groups;
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

export default function Profile() {
  const { userId } = useParams();
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
  const [externalProfile, setExternalProfile] = useState<UserProfile | null>(
    null
  );
  const [badges, setBadges] = useState<Badge[]>([]);
  const [userStats, setUserStats] = useState<UserStats | null>(null);
  const [remoteFavoriteGame, setRemoteFavoriteGame] = useState<UserGame | null>(
    null
  );
  const [remoteRecentActivityGames, setRemoteRecentActivityGames] = useState<
    UserGame[]
  >([]);
  const [remoteLibraryGames, setRemoteLibraryGames] = useState<UserGame[]>([]);
  const [remoteLibraryTotalCount, setRemoteLibraryTotalCount] = useState(0);
  const [recentAchievementGroups, setRecentAchievementGroups] = useState<
    ProfileRecentAchievementGroup[]
  >([]);
  const [friends, setFriends] = useState<UserFriend[]>([]);
  const [totalFriends, setTotalFriends] = useState(0);
  const [friendsTake, setFriendsTake] = useState(PROFILE_FRIENDS_LIMIT);
  const [achievementRefreshKey, setAchievementRefreshKey] = useState(0);
  const [isPerformingProfileAction, setIsPerformingProfileAction] =
    useState(false);
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
  const targetHasActiveSubscription = isOwnProfileTarget
    ? hasActiveSubscription
    : Boolean(externalProfile?.hasActiveSubscription);

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
    setFriendsTake(PROFILE_FRIENDS_LIMIT);
  }, [targetUserId]);

  useEffect(() => {
    if (!targetUserId) {
      setUserStats(null);
      setRemoteFavoriteGame(null);
      setRemoteRecentActivityGames([]);
      setRemoteLibraryGames([]);
      setRemoteLibraryTotalCount(0);
      setFriends([]);
      setTotalFriends(0);
      return;
    }

    let isMounted = true;
    setUserStats(null);

    const fetchRemoteLibraryGames = async (knownLibraryCount?: number) => {
      if (isOwnProfileTarget) return;

      try {
        if (typeof knownLibraryCount === "number" && knownLibraryCount <= 0) {
          if (!isMounted) return;

          setRemoteLibraryGames([]);
          setRemoteLibraryTotalCount(0);
          return;
        }

        if (knownLibraryCount) {
          const response =
            await globalThis.window.electron.hydraApi.get<UserLibraryResponse>(
              `/users/${targetUserId}/library?take=${knownLibraryCount}&skip=0`
            );

          if (!isMounted) return;

          setRemoteLibraryGames(response.library);
          setRemoteLibraryTotalCount(response.totalCount);
          return;
        }

        const remoteGames: UserGame[] = [];
        let skip = 0;
        let totalCount = 0;

        while (isMounted) {
          const response =
            await globalThis.window.electron.hydraApi.get<UserLibraryResponse>(
              `/users/${targetUserId}/library?take=${PROFILE_REMOTE_LIBRARY_PAGE_SIZE}&skip=${skip}`
            );

          totalCount = response.totalCount;
          remoteGames.push(...response.library);

          if (
            response.library.length < PROFILE_REMOTE_LIBRARY_PAGE_SIZE ||
            remoteGames.length >= response.totalCount
          ) {
            break;
          }

          skip += PROFILE_REMOTE_LIBRARY_PAGE_SIZE;
        }

        if (!isMounted) return;

        setRemoteLibraryGames(remoteGames);
        setRemoteLibraryTotalCount(totalCount || remoteGames.length);
      } catch {
        if (isMounted) setRemoteLibraryGames([]);
      }
    };

    globalThis.window.electron.hydraApi
      .get<UserStats>(`/users/${targetUserId}/stats`)
      .then((stats) => {
        if (!isMounted) return;

        setUserStats(stats);

        if (!isOwnProfileTarget) {
          setRemoteLibraryTotalCount(stats.libraryCount);
          void fetchRemoteLibraryGames(stats.libraryCount);
        }
      })
      .catch(() => {
        if (!isMounted) return;

        setUserStats(null);

        if (!isOwnProfileTarget) {
          void fetchRemoteLibraryGames();
        }
      });

    if (isOwnProfileTarget) {
      setRemoteFavoriteGame(null);
      setRemoteRecentActivityGames([]);
      setRemoteLibraryGames([]);
      setRemoteLibraryTotalCount(0);
    } else {
      setRemoteFavoriteGame(null);
      setRemoteRecentActivityGames([]);
      setRemoteLibraryGames([]);
      setRemoteLibraryTotalCount(0);

      globalThis.window.electron.hydraApi
        .get<UserLibraryResponse>(
          `/users/${targetUserId}/library?take=1&skip=0&sortBy=playtime`
        )
        .then((response) => {
          if (!isMounted) return;

          setRemoteFavoriteGame(response.library[0] ?? null);
        })
        .catch(() => {
          if (isMounted) setRemoteFavoriteGame(null);
        });

      globalThis.window.electron.hydraApi
        .get<UserLibraryResponse>(
          `/users/${targetUserId}/library?take=3&skip=0&sortBy=playedRecently`
        )
        .then((response) => {
          if (isMounted) setRemoteRecentActivityGames(response.library);
        })
        .catch(() => {
          if (isMounted) setRemoteRecentActivityGames([]);
        });
    }

    return () => {
      isMounted = false;
    };
  }, [isOwnProfileTarget, targetUserId]);

  useEffect(() => {
    if (!targetUserId) {
      setFriends([]);
      setTotalFriends(0);
      return;
    }

    let isMounted = true;
    const friendsPath = isOwnProfileTarget
      ? "/profile/friends"
      : `/users/${targetUserId}/friends`;

    globalThis.window.electron.hydraApi
      .get<UserFriends>(friendsPath, {
        params: {
          take: friendsTake,
          skip: 0,
        },
      })
      .then((response) => {
        if (!isMounted) return;

        setFriends(response.friends);
        setTotalFriends(response.totalFriends);
      })
      .catch(() => {
        if (!isMounted) return;

        setFriends([]);
        setTotalFriends(0);
      });

    return () => {
      isMounted = false;
    };
  }, [friendsTake, isOwnProfileTarget, targetUserId]);

  useEffect(() => {
    const unsubscribe = globalThis.window.electron.onAchievementUnlocked(() => {
      setAchievementRefreshKey((currentKey) => currentKey + 1);
    });

    return () => {
      unsubscribe();
    };
  }, []);

  useEffect(() => {
    if (!targetUserId || !targetHasActiveSubscription) {
      setRecentAchievementGroups([]);
      return;
    }

    let isMounted = true;

    const fetchRecentAchievementGroups = async () => {
      const searchParams = new URLSearchParams({
        take: String(PROFILE_RECENT_ACHIEVEMENT_LIBRARY_TAKE),
        skip: "0",
        sortBy: "achievementCount",
      });

      searchParams.append("shop", "steam");
      searchParams.append("shop", "launchbox");

      const response =
        await globalThis.window.electron.hydraApi.get<UserLibraryResponse>(
          `/users/${targetUserId}/library?${searchParams.toString()}`
        );

      const gamesWithAchievements = response.library.filter(
        (game) => (game.unlockedAchievementCount ?? 0) > 0
      );

      if (gamesWithAchievements.length === 0) {
        return [];
      }

      const settled = await Promise.allSettled(
        gamesWithAchievements.map(async (game) => {
          if (isOwnProfileTarget) {
            const unlockedAchievements =
              await globalThis.window.electron.getUnlockedAchievements(
                game.objectId,
                game.shop
              );

            return {
              game,
              achievements: unlockedAchievements
                .map(getOwnUnlockedAchievement)
                .filter(
                  (achievement): achievement is ProfileRecentAchievement =>
                    achievement !== null
                ),
            };
          }

          const comparedAchievements =
            await globalThis.window.electron.getComparedUnlockedAchievements(
              game.objectId,
              game.shop,
              targetUserId
            );

          return {
            game,
            achievements: comparedAchievements.achievements
              .map(getComparedAchievement)
              .filter(
                (achievement): achievement is ProfileRecentAchievement =>
                  achievement !== null
              ),
          };
        })
      );

      return settled
        .filter(
          (
            result
          ): result is PromiseFulfilledResult<{
            game: UserGame;
            achievements: ProfileRecentAchievement[];
          }> => result.status === "fulfilled"
        )
        .map((result) => result.value);
    };

    fetchRecentAchievementGroups()
      .then((achievementsByGame) => {
        if (!isMounted) return;

        setRecentAchievementGroups(
          buildRecentAchievementGroups(
            achievementsByGame.filter(
              ({ achievements }) => achievements.length > 0
            )
          )
        );
      })
      .catch(() => {
        if (isMounted) setRecentAchievementGroups([]);
      });

    return () => {
      isMounted = false;
    };
  }, [
    achievementRefreshKey,
    isOwnProfileTarget,
    targetHasActiveSubscription,
    targetUserId,
  ]);

  const profileUser = useMemo(
    () => getProfileHeroUser(userDetails, externalProfile, userId),
    [externalProfile, userDetails, userId]
  );

  const handleSignOut = async () => {
    await signOut();
    navigate(getBasePath() || "/");
  };

  const reloadExternalProfile = async (profileId: string) => {
    const profile = await globalThis.window.electron.hydraApi.get<UserProfile>(
      `/users/${profileId}`
    );

    setExternalProfile(profile);
  };

  const handleFriendAction = async (
    actionUserId: string,
    action: ProfileFriendAction
  ) => {
    if (!profileUser || profileUser.isOwnProfile) return;

    setIsPerformingProfileAction(true);

    try {
      if (action === "SEND") {
        await sendFriendRequest(profileUser.id);
        await reloadExternalProfile(profileUser.id);
        return;
      }

      if (action === "UNDO_FRIENDSHIP") {
        await undoFriendship(actionUserId);
        await reloadExternalProfile(profileUser.id);
        return;
      }

      if (action === "BLOCK") {
        await blockUser(actionUserId);
        navigate(-1);
        return;
      }

      await updateFriendRequestState(actionUserId, action);
      await reloadExternalProfile(profileUser.id);
    } catch {
      // Keep the current profile visible if the relationship action fails.
    } finally {
      setIsPerformingProfileAction(false);
    }
  };

  const isLoading =
    isLoadingExternalProfile || (!profileUser && Boolean(targetUserId));
  const heroImageUrl = profileUser?.backgroundImageUrl ?? null;
  const { backgroundLayers, getLayerEventHandlers } =
    useHeroBackgroundLayers(heroImageUrl);
  const usernameLabel = profileUser?.username || profileUser?.id || "";
  const visibleBadges = useMemo(() => {
    if (!profileUser?.badges.length) return [];

    return profileUser.badges
      .map((badgeName) => badges.find((badge) => badge.name === badgeName))
      .filter((badge): badge is Badge => Boolean(badge));
  }, [badges, profileUser?.badges]);
  const localFavoriteGame = useMemo<LibraryGame | null>(() => {
    if (!isOwnProfileTarget) return null;

    return (
      [...library]
        .filter((game) => (game.playTimeInMilliseconds ?? 0) > 0)
        .sort(
          (a, b) =>
            (b.playTimeInMilliseconds ?? 0) - (a.playTimeInMilliseconds ?? 0)
        )[0] ?? null
    );
  }, [isOwnProfileTarget, library]);
  const remoteFavoriteGameFallback = useMemo<UserGame | null>(() => {
    return (
      [...remoteLibraryGames]
        .filter((game) => (game.playTimeInSeconds ?? 0) > 0)
        .sort(
          (a, b) => (b.playTimeInSeconds ?? 0) - (a.playTimeInSeconds ?? 0)
        )[0] ?? null
    );
  }, [remoteLibraryGames]);
  const favoriteGame: ProfileFavoriteGame | null = profileUser?.isOwnProfile
    ? localFavoriteGame
    : (remoteFavoriteGame ?? remoteFavoriteGameFallback);
  const favoriteGameImageUrl = getFavoriteGameImage(favoriteGame);
  const favoriteGamePlaytimeInSeconds =
    getFavoriteGamePlaytimeInSeconds(favoriteGame);
  const localRecentActivityGames = useMemo<LibraryGame[]>(() => {
    if (!isOwnProfileTarget) return [];

    return [...library]
      .filter((game) => getDateTimestamp(game.lastTimePlayed) !== null)
      .sort((a, b) => {
        return (
          (getDateTimestamp(b.lastTimePlayed) ?? 0) -
          (getDateTimestamp(a.lastTimePlayed) ?? 0)
        );
      })
      .slice(0, 3);
  }, [isOwnProfileTarget, library]);
  const remoteRecentActivityFallbackGames = useMemo<UserGame[]>(() => {
    return [...remoteLibraryGames]
      .filter((game) => getDateTimestamp(game.lastTimePlayed) !== null)
      .sort((a, b) => {
        return (
          (getDateTimestamp(b.lastTimePlayed) ?? 0) -
          (getDateTimestamp(a.lastTimePlayed) ?? 0)
        );
      })
      .slice(0, 3);
  }, [remoteLibraryGames]);
  const recentActivityGames: ProfileActivityGame[] = profileUser?.isOwnProfile
    ? localRecentActivityGames
    : remoteRecentActivityGames.length > 0
      ? remoteRecentActivityGames
      : remoteRecentActivityFallbackGames;
  const libraryCarouselGames = useMemo<ProfileLibraryCarouselGame[]>(() => {
    const sourceGames = profileUser?.isOwnProfile
      ? library
      : remoteLibraryGames;

    return sourceGames.map(toProfileLibraryCarouselGame);
  }, [library, profileUser?.isOwnProfile, remoteLibraryGames]);
  const totalLibraryGames = profileUser?.isOwnProfile
    ? library.length
    : (userStats?.libraryCount ?? remoteLibraryTotalCount);
  const profileHasActiveSubscription = targetHasActiveSubscription;
  const canViewRecentAchievements =
    Boolean(profileUser) && profileHasActiveSubscription;
  const canFocusRecentAchievements =
    canViewRecentAchievements && Boolean(profileUser?.isOwnProfile);
  const firstActivityFocusId = recentActivityGames[0]
    ? getProfileActivityFocusId(recentActivityGames[0])
    : null;
  const lastActivityGame =
    recentActivityGames.length > 0
      ? recentActivityGames[recentActivityGames.length - 1]
      : null;
  const lastActivityFocusId = lastActivityGame
    ? getProfileActivityFocusId(lastActivityGame)
    : null;
  const firstLibraryFocusId = libraryCarouselGames[0]
    ? getProfileLibraryGameItemId(libraryCarouselGames[0])
    : null;
  const firstAchievementFocusId =
    canFocusRecentAchievements && recentAchievementGroups[0]
      ? getProfileAchievementFocusId(recentAchievementGroups[0].game)
      : null;
  const lastAchievementGroup =
    recentAchievementGroups.length > 0
      ? recentAchievementGroups[recentAchievementGroups.length - 1]
      : null;
  const lastAchievementFocusId =
    canFocusRecentAchievements && lastAchievementGroup
      ? getProfileAchievementFocusId(lastAchievementGroup.game)
      : null;
  const firstFriendFocusId = friends[0]
    ? getProfileFriendItemId(friends[0].id)
    : null;
  const lastFriend = friends.length > 0 ? friends[friends.length - 1] : null;
  const lastFriendFocusId = lastFriend
    ? getProfileFriendItemId(lastFriend.id)
    : null;
  const firstSocialFocusId = firstAchievementFocusId ?? firstFriendFocusId;
  const firstContentFocusId =
    firstActivityFocusId ?? firstLibraryFocusId ?? firstSocialFocusId;
  const activityDownFocusId = firstLibraryFocusId ?? firstSocialFocusId;
  const libraryDownFocusId = firstSocialFocusId;
  const heroActionsFocusId = profileUser?.isOwnProfile
    ? PROFILE_HERO_SIGN_OUT_BUTTON_ID
    : profileUser
      ? PROFILE_HERO_EXTERNAL_PRIMARY_ACTION_ID
      : null;
  const libraryUpFocusId = lastActivityFocusId ?? heroActionsFocusId;
  const socialUpFocusId =
    firstLibraryFocusId ?? lastActivityFocusId ?? heroActionsFocusId;
  const showFriendsViewAll = totalFriends > friends.length;
  const externalProfileActions = useMemo<ProfileHeroAction[]>(() => {
    if (!profileUser || profileUser.isOwnProfile || !externalProfile) return [];

    if (externalProfile.relation === null) {
      return [
        {
          label: "Add Friend",
          variant: "secondary",
          icon: <UserPlusIcon size={20} />,
          onClick: () => {
            void handleFriendAction(externalProfile.id, "SEND");
          },
        },
        {
          label: "Block User",
          variant: "danger",
          icon: <ProhibitIcon size={20} />,
          onClick: () => {
            void handleFriendAction(externalProfile.id, "BLOCK");
          },
        },
      ];
    }

    if (externalProfile.relation.status === "ACCEPTED") {
      return [
        {
          label: "Remove Friend",
          variant: "secondary",
          icon: <UserMinusIcon size={20} />,
          onClick: () => {
            void handleFriendAction(externalProfile.id, "UNDO_FRIENDSHIP");
          },
        },
        {
          label: "Block User",
          variant: "danger",
          icon: <ProhibitIcon size={20} />,
          onClick: () => {
            void handleFriendAction(externalProfile.id, "BLOCK");
          },
        },
      ];
    }

    if (externalProfile.relation.BId === externalProfile.id) {
      return [
        {
          label: "Cancel Request",
          variant: "secondary",
          icon: <XCircleIcon size={20} />,
          onClick: () => {
            void handleFriendAction(externalProfile.relation!.BId, "CANCEL");
          },
        },
      ];
    }

    return [
      {
        label: "Accept Request",
        variant: "secondary",
        icon: <CheckCircleIcon size={20} />,
        onClick: () => {
          void handleFriendAction(externalProfile.relation!.AId, "ACCEPTED");
        },
      },
      {
        label: "Ignore Request",
        variant: "danger",
        icon: <XCircleIcon size={20} />,
        onClick: () => {
          void handleFriendAction(externalProfile.relation!.AId, "REFUSED");
        },
      },
    ];
  }, [externalProfile, handleFriendAction, profileUser]);
  const hasSecondaryExternalAction = externalProfileActions.length > 1;

  const signOutNavigationOverrides: FocusOverrides = {
    left: {
      type: "item",
      itemId: BIG_PICTURE_SIDEBAR_PROFILE_ID,
    },
    right: {
      type: "block",
    },
    down: firstContentFocusId
      ? {
          type: "item",
          itemId: firstContentFocusId,
        }
      : {
          type: "block",
        },
  };
  const externalPrimaryNavigationOverrides: FocusOverrides = {
    left: {
      type: "item",
      itemId: BIG_PICTURE_SIDEBAR_PROFILE_ID,
    },
    right: hasSecondaryExternalAction
      ? {
          type: "item",
          itemId: PROFILE_HERO_EXTERNAL_SECONDARY_ACTION_ID,
        }
      : {
          type: "block",
        },
    down: firstContentFocusId
      ? {
          type: "item",
          itemId: firstContentFocusId,
        }
      : {
          type: "block",
        },
  };
  const externalSecondaryNavigationOverrides: FocusOverrides = {
    left: {
      type: "item",
      itemId: PROFILE_HERO_EXTERNAL_PRIMARY_ACTION_ID,
    },
    right: {
      type: "block",
    },
    down: firstContentFocusId
      ? {
          type: "item",
          itemId: firstContentFocusId,
        }
      : {
          type: "block",
        },
  };

  return (
    <VerticalFocusGroup regionId={PROFILE_PAGE_REGION_ID} asChild>
      <section className="profile-page">
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
                      layer.isVisible
                        ? "profile-page__hero-bg-layer--visible"
                        : "",
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

            {profileUser?.isOwnProfile ? (
              <HorizontalFocusGroup
                regionId={PROFILE_HERO_ACTIONS_REGION_ID}
                className="profile-page__actions"
              >
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
            ) : externalProfileActions.length > 0 ? (
              <HorizontalFocusGroup
                regionId={PROFILE_HERO_ACTIONS_REGION_ID}
                className="profile-page__actions"
              >
                {externalProfileActions.map((action, index) => (
                  <Button
                    key={action.label}
                    variant={action.variant}
                    icon={action.icon}
                    focusId={
                      index === 0
                        ? PROFILE_HERO_EXTERNAL_PRIMARY_ACTION_ID
                        : PROFILE_HERO_EXTERNAL_SECONDARY_ACTION_ID
                    }
                    focusNavigationOverrides={
                      index === 0
                        ? externalPrimaryNavigationOverrides
                        : externalSecondaryNavigationOverrides
                    }
                    loading={isPerformingProfileAction}
                    onClick={action.onClick}
                  >
                    {action.label}
                  </Button>
                ))}
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
          <div className="profile-page__sections">
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
                    <div className="profile-page__stat-label">
                      Avg. Playtime
                    </div>
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

                    <div className="profile-page__stat-label">
                      Favorite Game
                    </div>
                  </div>
                </article>

                <div className="profile-page__stat-pair">
                  <article className="profile-page__stat-card profile-page__stat-card--pair-left">
                    <div className="profile-page__stat-main">
                      <div className="profile-page__stat-value">
                        <TrophyIcon size={36} />
                        <span>
                          {formatCompactNumber(
                            userStats?.unlockedAchievementSum
                          )}
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
                    <div className="profile-page__stat-label">
                      Earned Points
                    </div>
                  </article>
                </div>
              </div>
            </section>

            <section className="profile-page__activity-section">
              <div className="profile-page__activity-header">
                <h2>Recent Activity</h2>
              </div>

              {recentActivityGames.length > 0 ? (
                <VerticalFocusGroup
                  regionId={PROFILE_RECENT_ACTIVITY_REGION_ID}
                  className="profile-page__activity-list"
                  style={{ gap: "calc(var(--spacing-unit) * 4)" }}
                >
                  {recentActivityGames.map((game) => {
                    const imageUrl = getGameLandscapeImageSource(game);
                    const focusId = getProfileActivityFocusId(game);

                    return (
                      <FocusItem
                        key={`${game.title}-${game.lastTimePlayed ?? "recent"}`}
                        id={focusId}
                        actions={{
                          primary: () =>
                            navigate(getBigPictureGameDetailsPath(game)),
                        }}
                        navigationOverrides={{
                          up:
                            focusId === firstActivityFocusId
                              ? heroActionsFocusId
                                ? {
                                    type: "item",
                                    itemId: heroActionsFocusId,
                                  }
                                : {
                                    type: "block",
                                  }
                              : undefined,
                          down:
                            focusId === lastActivityFocusId
                              ? activityDownFocusId
                                ? {
                                    type: "item",
                                    itemId: activityDownFocusId,
                                  }
                                : {
                                    type: "block",
                                  }
                              : undefined,
                        }}
                        asChild
                      >
                        <button
                          type="button"
                          className="profile-page__activity-item"
                          onClick={() =>
                            navigate(getBigPictureGameDetailsPath(game))
                          }
                        >
                          <div className="profile-page__activity-media">
                            {imageUrl ? (
                              <img
                                src={imageUrl}
                                alt={game.title}
                                draggable={false}
                              />
                            ) : null}
                          </div>

                          <div className="profile-page__activity-copy">
                            <h3>{game.title}</h3>
                            <p>{getActivityLastPlayedLabel(game)}</p>
                          </div>

                          <span className="profile-page__activity-playtime">
                            {formatPlayedTime(
                              getActivityPlaytimeInMilliseconds(game)
                            )}
                          </span>
                        </button>
                      </FocusItem>
                    );
                  })}
                </VerticalFocusGroup>
              ) : (
                <p className="profile-page__activity-empty">
                  No recent activity
                </p>
              )}
            </section>

            <div className="profile-page__library-carousel">
              <FocusCarousel
                title="Library"
                headerMeta={formatCompactNumber(totalLibraryGames)}
                cardMode="library"
                cardVariant="vertical"
                games={libraryCarouselGames}
                regionId={PROFILE_LIBRARY_CAROUSEL_REGION_ID}
                getItemId={getProfileLibraryGameItemId}
                getItemNavigationOverrides={() => ({
                  up: libraryUpFocusId
                    ? {
                        type: "item",
                        itemId: libraryUpFocusId,
                      }
                    : {
                        type: "block",
                      },
                  down: libraryDownFocusId
                    ? {
                        type: "item",
                        itemId: libraryDownFocusId,
                      }
                    : {
                        type: "block",
                      },
                })}
                onItemActivate={(game) => {
                  navigate(getBigPictureGameDetailsPath(game));
                }}
                showRightFade
              />
            </div>

            <HorizontalFocusGroup
              regionId={PROFILE_SOCIAL_REGION_ID}
              className="profile-page__social-section"
              asChild
            >
              <section className="profile-page__social-section">
                {profileUser ? (
                  <VerticalFocusGroup
                    regionId={PROFILE_ACHIEVEMENTS_REGION_ID}
                    className="profile-page__achievements-section"
                    style={{ gap: "calc(var(--spacing-unit) * 5)" }}
                  >
                    <div className="profile-page__section-header">
                      <h2>Recent Achievements</h2>
                      <span>
                        {formatCompactNumber(userStats?.unlockedAchievementSum)}
                      </span>
                    </div>

                    {canViewRecentAchievements ? (
                      recentAchievementGroups.length > 0 ? (
                        <div className="profile-page__achievement-groups">
                          {recentAchievementGroups.map((group) => {
                            const groupKey = getRecentAchievementGameKey(
                              group.game
                            );
                            const gameIconUrl = getRecentAchievementGameIcon(
                              group.game
                            );
                            const focusId = getProfileAchievementFocusId(
                              group.game
                            );
                            const achievementGroupContent = (
                              <>
                                <div className="profile-page__achievement-game-header">
                                  <div className="profile-page__achievement-game-copy">
                                    {gameIconUrl ? (
                                      <img
                                        src={gameIconUrl}
                                        alt=""
                                        draggable={false}
                                      />
                                    ) : (
                                      <TrophyIcon size={20} />
                                    )}
                                    <span>{group.game.title}</span>
                                  </div>

                                  <div className="profile-page__achievement-game-meta">
                                    <span>({group.newCount} new)</span>
                                    <strong>
                                      {group.game.unlockedAchievementCount ?? 0}
                                      /{group.game.achievementCount ?? 0}
                                    </strong>
                                  </div>
                                </div>

                                <div className="profile-page__achievement-list">
                                  {group.achievements.map((achievement) => {
                                    return (
                                      <div
                                        key={`${group.game.objectId}-${achievement.key}`}
                                        className="profile-page__achievement-row"
                                      >
                                        <img
                                          src={achievement.icon}
                                          alt=""
                                          draggable={false}
                                        />

                                        <div className="profile-page__achievement-copy">
                                          <h3>{achievement.displayName}</h3>
                                          {achievement.description ? (
                                            <p>{achievement.description}</p>
                                          ) : null}
                                        </div>

                                        <div className="profile-page__achievement-meta">
                                          <span>
                                            Earned{" "}
                                            {formatRelativeDate(
                                              achievement.unlockTime,
                                              {
                                                fallback: "recently",
                                              }
                                            )}
                                          </span>
                                        </div>
                                      </div>
                                    );
                                  })}
                                </div>
                              </>
                            );

                            if (!profileUser?.isOwnProfile) {
                              return (
                                <div
                                  key={groupKey}
                                  className="profile-page__achievement-group"
                                >
                                  {achievementGroupContent}
                                </div>
                              );
                            }

                            return (
                              <FocusItem
                                key={groupKey}
                                id={focusId}
                                actions={{
                                  primary: () =>
                                    navigate(
                                      getBigPictureGameAchievementsPath(
                                        group.game
                                      )
                                    ),
                                }}
                                navigationOverrides={{
                                  up:
                                    focusId === firstAchievementFocusId
                                      ? socialUpFocusId
                                        ? {
                                            type: "item",
                                            itemId: socialUpFocusId,
                                          }
                                        : {
                                            type: "block",
                                          }
                                      : undefined,
                                  right: firstFriendFocusId
                                    ? {
                                        type: "item",
                                        itemId: firstFriendFocusId,
                                      }
                                    : undefined,
                                  down:
                                    focusId === lastAchievementFocusId
                                      ? {
                                          type: "block",
                                        }
                                      : undefined,
                                }}
                                asChild
                              >
                                <button
                                  type="button"
                                  className="profile-page__achievement-group"
                                  onClick={() =>
                                    navigate(
                                      getBigPictureGameAchievementsPath(
                                        group.game
                                      )
                                    )
                                  }
                                >
                                  {achievementGroupContent}
                                </button>
                              </FocusItem>
                            );
                          })}
                        </div>
                      ) : (
                        <p className="profile-page__activity-empty">
                          No recent achievements
                        </p>
                      )
                    ) : (
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
                                    onError={(event) => {
                                      event.currentTarget.style.opacity = "0";
                                    }}
                                  />
                                </span>
                                <span className="profile-page__locked-preview-game-title">
                                  {LOCKED_ACHIEVEMENT_PREVIEW.gameTitle}
                                </span>
                              </div>

                              <div className="profile-page__achievement-game-meta">
                                <span>
                                  ({LOCKED_ACHIEVEMENT_PREVIEW.newCount} new)
                                </span>
                                <strong>
                                  {LOCKED_ACHIEVEMENT_PREVIEW.unlockedCount}/
                                  {LOCKED_ACHIEVEMENT_PREVIEW.achievementCount}
                                </strong>
                              </div>
                            </div>

                            <div className="profile-page__achievement-list">
                              {LOCKED_ACHIEVEMENT_PREVIEW.achievements.map(
                                (achievement) => (
                                  <div
                                    key={achievement.displayName}
                                    className="profile-page__achievement-row"
                                  >
                                    <span className="profile-page__locked-preview-achievement-icon">
                                      <img
                                        src={achievement.imageUrl}
                                        alt=""
                                        draggable={false}
                                        onError={(event) => {
                                          event.currentTarget.style.opacity =
                                            "0";
                                        }}
                                      />
                                    </span>

                                    <div className="profile-page__achievement-copy profile-page__locked-preview-achievement-copy">
                                      <h3>{achievement.displayName}</h3>
                                      <p>{achievement.description}</p>
                                    </div>

                                    <div className="profile-page__achievement-meta">
                                      <strong>
                                        +{achievement.points} pts.
                                      </strong>
                                      <span>{achievement.earnedLabel}</span>
                                    </div>
                                  </div>
                                )
                              )}
                            </div>
                          </div>
                        </div>

                        <div className="profile-page__achievements-lock-overlay">
                          <SparkleIcon size={24} weight="fill" />
                          <p>
                            This user is required to have Hydra Cloud in order
                            to display achievements in his profile.
                          </p>
                        </div>
                      </div>
                    )}
                  </VerticalFocusGroup>
                ) : (
                  <div />
                )}

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
                      {friends.map((friend) => {
                        const friendGameIconUrl = getFriendGameIcon(
                          friend.currentGame
                        );
                        const focusId = getProfileFriendItemId(friend.id);

                        return (
                          <FocusItem
                            key={friend.id}
                            id={focusId}
                            actions={{
                              primary: () =>
                                navigate(
                                  `${getBasePath()}/profile/${friend.id}`
                                ),
                            }}
                            navigationOverrides={{
                              up:
                                focusId === firstFriendFocusId
                                  ? socialUpFocusId
                                    ? {
                                        type: "item",
                                        itemId: socialUpFocusId,
                                      }
                                    : {
                                        type: "block",
                                      }
                                  : undefined,
                              left: firstAchievementFocusId
                                ? {
                                    type: "item",
                                    itemId: firstAchievementFocusId,
                                  }
                                : undefined,
                              down:
                                focusId === lastFriendFocusId
                                  ? showFriendsViewAll
                                    ? {
                                        type: "item",
                                        itemId: PROFILE_FRIENDS_VIEW_ALL_ID,
                                      }
                                    : {
                                        type: "block",
                                      }
                                  : undefined,
                            }}
                            asChild
                          >
                            <button
                              type="button"
                              className="profile-page__friend-row"
                              onClick={() =>
                                navigate(
                                  `${getBasePath()}/profile/${friend.id}`
                                )
                              }
                            >
                              <div className="profile-page__friend-profile">
                                {friend.profileImageUrl ? (
                                  <img
                                    src={friend.profileImageUrl}
                                    alt=""
                                    draggable={false}
                                  />
                                ) : (
                                  <UserCircleIcon size={56} />
                                )}
                                <span>{friend.displayName}</span>
                              </div>

                              {friend.currentGame ? (
                                <div className="profile-page__friend-game">
                                  <div className="profile-page__friend-game-title">
                                    {friendGameIconUrl ? (
                                      <img
                                        src={friendGameIconUrl}
                                        alt=""
                                        draggable={false}
                                      />
                                    ) : null}
                                    <span>{friend.currentGame.title}</span>
                                  </div>
                                  <span>
                                    {formatSessionDuration(
                                      friend.currentGame
                                        .sessionDurationInSeconds
                                    )}
                                  </span>
                                </div>
                              ) : null}
                            </button>
                          </FocusItem>
                        );
                      })}
                      {showFriendsViewAll ? (
                        <FocusItem
                          id={PROFILE_FRIENDS_VIEW_ALL_ID}
                          actions={{
                            primary: () => setFriendsTake(totalFriends),
                          }}
                          navigationOverrides={{
                            up: lastFriendFocusId
                              ? {
                                  type: "item",
                                  itemId: lastFriendFocusId,
                                }
                              : undefined,
                            left: firstAchievementFocusId
                              ? {
                                  type: "item",
                                  itemId: firstAchievementFocusId,
                                }
                              : undefined,
                            down: {
                              type: "block",
                            },
                          }}
                          asChild
                        >
                          <button
                            type="button"
                            className="profile-page__friends-view-all"
                            onClick={() => setFriendsTake(totalFriends)}
                          >
                            View All
                          </button>
                        </FocusItem>
                      ) : null}
                    </div>
                  ) : (
                    <p className="profile-page__activity-empty">No friends</p>
                  )}
                </VerticalFocusGroup>
              </section>
            </HorizontalFocusGroup>
          </div>
        ) : null}
      </section>
    </VerticalFocusGroup>
  );
}
