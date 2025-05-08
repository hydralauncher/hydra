import type { Cracker, DownloadSourceStatus, Downloader } from "@shared";
import type { SteamAppDetails } from "./steam.types";
import type { Download, Game, Subscription } from "./level.types";
import type { GameShop, UnlockedAchievement } from "./game.types";

export type FriendRequestAction = "ACCEPTED" | "REFUSED" | "CANCEL";

export type HydraCloudFeature =
  | "achievements"
  | "backup"
  | "achievements-points";

export interface GameRepack {
  id: number;
  title: string;
  uris: string[];
  repacker: string;
  fileSize: string | null;
  objectIds: string[];
  uploadDate: Date | string | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface DownloadSource {
  id: number;
  name: string;
  url: string;
  repackCount: number;
  status: DownloadSourceStatus;
  objectIds: string[];
  downloadCount: number;
  fingerprint: string;
  etag: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface ShopAssets {
  objectId: string;
  shop: GameShop;
  title: string;
  coverImageUrl: string;
  libraryHeroImageUrl: string;
  libraryImageUrl: string;
  logoImageUrl: string;
  iconUrl: string | null;
  logoPosition: string | null;
}

export type ShopDetails = SteamAppDetails & {
  objectId: string;
};

export type ShopDetailsWithAssets = ShopDetails & Partial<ShopAssets>;

export interface TorrentFile {
  path: string;
  length: number;
}

export interface UserGame {
  objectId: string;
  shop: GameShop;
  title: string;
  iconUrl: string | null;
  libraryHeroImageUrl: string;
  libraryImageUrl: string;
  logoImageUrl: string;
  coverImageUrl: string;
  playTimeInSeconds: number;
  lastTimePlayed: Date | null;
  unlockedAchievementCount: number;
  achievementCount: number;
  achievementsPointsEarnedSum: number;
}

export interface GameRunning {
  id: string;
  title: string;
  iconUrl: string | null;
  objectId: string;
  shop: GameShop;
  sessionDurationInMillis: number;
}

export interface Steam250Game {
  title: string;
  objectId: string;
}

export interface SteamGame {
  id: number;
  name: string;
  clientIcon: string | null;
}

export type AppUpdaterEvent =
  | { type: "update-available"; info: { version: string } }
  | { type: "update-downloaded" };

/* Events */
export interface StartGameDownloadPayload {
  repackId: number;
  objectId: string;
  title: string;
  shop: GameShop;
  uri: string;
  downloadPath: string;
  downloader: Downloader;
  automaticallyExtract: boolean;
}

export interface UserFriend {
  id: string;
  displayName: string;
  profileImageUrl: string | null;
  createdAt: string;
  updatedAt: string;
  currentGame: {
    title: string;
    iconUrl: string;
    libraryHeroImageUrl: string;
    libraryImageUrl: string;
    logoImageUrl: string;
    coverImageUrl: string;
    objectId: string;
    shop: GameShop;
    sessionDurationInSeconds: number;
  } | null;
}

export interface UserFriends {
  totalFriends: number;
  friends: UserFriend[];
}

export interface UserBlocks {
  totalBlocks: number;
  blocks: UserFriend[];
}

export interface FriendRequestSync {
  friendRequestCount: number;
}

export interface FriendRequest {
  id: string;
  displayName: string;
  profileImageUrl: string | null;
  type: "SENT" | "RECEIVED";
}

export interface UserRelation {
  AId: string;
  BId: string;
  status: "ACCEPTED" | "PENDING";
  createdAt: string;
  updatedAt: string;
}

export interface UserProfileCurrentGame extends Omit<GameRunning, "objectId"> {
  objectId: string;
  sessionDurationInSeconds: number;
  libraryHeroImageUrl: string;
  libraryImageUrl: string;
  logoImageUrl: string;
  coverImageUrl: string;
}

export type ProfileVisibility = "PUBLIC" | "PRIVATE" | "FRIENDS";

export interface Badge {
  name: string;
  description: string;
  badge: {
    url: string;
  };
}

export interface UserDetails {
  id: string;
  username: string;
  email: string | null;
  displayName: string;
  profileImageUrl: string | null;
  backgroundImageUrl: string | null;
  profileVisibility: ProfileVisibility;
  bio: string;
  featurebaseJwt: string;
  subscription: Subscription | null;
  quirks?: {
    backupsPerGameLimit: number;
  };
}

export interface UserProfile {
  id: string;
  displayName: string;
  profileImageUrl: string | null;
  email: string | null;
  backgroundImageUrl: string | null;
  profileVisibility: ProfileVisibility;
  libraryGames: UserGame[];
  recentGames: UserGame[];
  friends: UserFriend[];
  totalFriends: number;
  relation: UserRelation | null;
  currentGame: UserProfileCurrentGame | null;
  bio: string;
  hasActiveSubscription: boolean;
  quirks: {
    backupsPerGameLimit: number;
  };
  badges: string[];
}

export interface UpdateProfileRequest {
  displayName?: string;
  profileVisibility?: ProfileVisibility;
  profileImageUrl?: string | null;
  backgroundImageUrl?: string | null;
  bio?: string;
  language?: string;
}

export interface DownloadSourceDownload {
  title: string;
  uris: string[];
  uploadDate: string;
  fileSize: string;
}

export interface DownloadSourceValidationResult {
  name: string;
  etag: string;
  downloadCount: number;
}

export interface GameStats {
  downloadCount: number;
  playerCount: number;
  assets: ShopAssets | null;
}

export interface TrendingGame extends ShopAssets {
  description: string | null;
  uri: string;
}

export interface UserStatsPercentile {
  value: number;
  topPercentile: number;
}

export interface UserStats {
  libraryCount: number;
  friendsCount: number;
  totalPlayTimeInSeconds: UserStatsPercentile;
  achievementsPointsEarnedSum?: UserStatsPercentile;
  unlockedAchievementSum?: number;
}

export interface UpdatedUnlockedAchievements {
  objectId: string;
  shop: GameShop;
  achievements: UnlockedAchievement[];
}

export interface AchievementFile {
  type: Cracker;
  filePath: string;
}

export type GameAchievementFiles = {
  [id: string]: AchievementFile[];
};

export interface GameArtifact {
  id: string;
  artifactLengthInBytes: number;
  downloadOptionTitle: string | null;
  createdAt: string;
  updatedAt: string;
  hostname: string;
  downloadCount: number;
  label?: string;
}

export interface ComparedAchievements {
  achievementsPointsTotal: number;
  owner: {
    totalAchievementCount: number;
    unlockedAchievementCount: number;
    achievementsPointsEarnedSum?: number;
  };
  target: {
    displayName: string;
    profileImageUrl: string;
    totalAchievementCount: number;
    unlockedAchievementCount: number;
    achievementsPointsEarnedSum: number;
  };
  achievements: {
    hidden: boolean;
    icon: string;
    displayName: string;
    description: string;
    ownerStat?: {
      unlocked: boolean;
      unlockTime: number;
    };
    targetStat: {
      unlocked: boolean;
      unlockTime: number;
    };
  }[];
}

export interface CatalogueSearchPayload {
  title: string;
  downloadSourceFingerprints: string[];
  tags: number[];
  publishers: string[];
  genres: string[];
  developers: string[];
}

export interface CatalogueSearchResult {
  id: string;
  tags: string[];
  genres: string[];
  objectId: string;
  shop: GameShop;
  createdAt: Date;
  updatedAt: Date;
  title: string;
  installCount: number;
  achievementCount: number;
  iconUrl: string;
  coverImageUrl: string;
  libraryHeroImageUrl: string;
  libraryImageUrl: string;
  logoImageUrl: string;
  logoPosition: string | null;
  shopData: string;
}

export type LibraryGame = Game &
  Partial<ShopAssets> & {
    id: string;
    download: Download | null;
  };

export * from "./game.types";
export * from "./steam.types";
export * from "./download.types";
export * from "./ludusavi.types";
export * from "./how-long-to-beat.types";
export * from "./level.types";
export * from "./theme.types";
