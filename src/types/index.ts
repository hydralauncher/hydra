import type { Cracker, DownloadSourceStatus, Downloader } from "@shared";
import type { SteamAppDetails } from "./steam.types";

export type GameStatus =
  | "active"
  | "waiting"
  | "paused"
  | "error"
  | "complete"
  | "seeding"
  | "removed";

export type GameShop = "steam" | "epic";

export type FriendRequestAction = "ACCEPTED" | "REFUSED" | "CANCEL";

export interface GameRepack {
  id: number;
  title: string;
  /**
   * @deprecated Use uris instead
   */
  magnet: string;
  uris: string[];
  repacker: string;
  fileSize: string | null;
  uploadDate: Date | string | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface AchievementData {
  name: string;
  displayName: string;
  description?: string;
  icon: string;
  icongray: string;
  hidden: boolean;
}

export interface UserAchievement {
  name: string;
  hidden: boolean;
  displayName: string;
  description?: string;
  unlocked: boolean;
  unlockTime: number | null;
  icon: string;
  icongray: string;
}

export interface RemoteUnlockedAchievement {
  name: string;
  hidden: boolean;
  icon: string;
  displayName: string;
  description?: string;
  unlockTime: number;
}

export interface GameAchievement {
  name: string;
  hidden: boolean;
  displayName: string;
  description?: string;
  unlocked: boolean;
  unlockTime: number | null;
  icon: string;
  icongray: string;
}

export type ShopDetails = SteamAppDetails & {
  objectId: string;
};

export interface TorrentFile {
  path: string;
  length: number;
}

/* Used by the catalogue */
export interface CatalogueEntry {
  objectId: string;
  shop: GameShop;
  title: string;
  /* Epic Games covers cannot be guessed with objectID */
  cover: string;
}

export interface UserGame {
  objectId: string;
  shop: GameShop;
  title: string;
  iconUrl: string | null;
  cover: string;
  playTimeInSeconds: number;
  lastTimePlayed: Date | null;
  unlockedAchievementCount: number;
  achievementCount: number;
}

export interface DownloadQueue {
  id: number;
  createdAt: Date;
  updatedAt: Date;
}

/* Used by the library */
export interface Game {
  id: number;
  title: string;
  iconUrl: string;
  status: GameStatus | null;
  folderName: string;
  downloadPath: string | null;
  progress: number;
  bytesDownloaded: number;
  playTimeInMilliseconds: number;
  downloader: Downloader;
  winePrefixPath: string | null;
  executablePath: string | null;
  lastTimePlayed: Date | null;
  uri: string | null;
  fileSize: number;
  objectID: string;
  shop: GameShop;
  downloadQueue: DownloadQueue | null;
  shouldSeed: boolean;
  createdAt: Date;
  updatedAt: Date;
}

export type LibraryGame = Omit<Game, "repacks">;

export interface GameRunning {
  id?: number;
  title: string;
  iconUrl: string | null;
  objectID: string;
  shop: GameShop;
  sessionDurationInMillis: number;
}

export interface DownloadProgress {
  downloadSpeed: number;
  timeRemaining: number;
  numPeers: number;
  numSeeds: number;
  isDownloadingMetadata: boolean;
  isCheckingFiles: boolean;
  progress: number;
  gameId: number;
  game: LibraryGame;
}

export interface SeedingStatus {
  gameId: number;
  status: GameStatus;
  uploadSpeed: number;
}

export interface UserPreferences {
  downloadsPath: string | null;
  language: string;
  downloadNotificationsEnabled: boolean;
  repackUpdatesNotificationsEnabled: boolean;
  achievementNotificationsEnabled: boolean;
  realDebridApiToken: string | null;
  preferQuitInsteadOfHiding: boolean;
  runAtStartup: boolean;
  startMinimized: boolean;
  disableNsfwAlert: boolean;
  seedAfterDownloadComplete: boolean;
  showHiddenAchievementsDescription: boolean;
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
}

export interface UserFriend {
  id: string;
  displayName: string;
  profileImageUrl: string | null;
  createdAt: string;
  updatedAt: string;
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
}

export type ProfileVisibility = "PUBLIC" | "PRIVATE" | "FRIENDS";

export type SubscriptionStatus = "active" | "pending" | "cancelled";

export interface Subscription {
  id: string;
  status: SubscriptionStatus;
  plan: { id: string; name: string };
  expiresAt: string | null;
  paymentMethod: "pix" | "paypal";
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
  subscription: Subscription | null;
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
}

export interface UpdateProfileRequest {
  displayName?: string;
  profileVisibility?: ProfileVisibility;
  profileImageUrl?: string | null;
  backgroundImageUrl?: string | null;
  bio?: string;
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

export interface DownloadSource {
  id: number;
  name: string;
  url: string;
  repackCount: number;
  status: DownloadSourceStatus;
  downloadCount: number;
  etag: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface GameStats {
  downloadCount: number;
  playerCount: number;
}

export interface TrendingGame {
  uri: string;
  description: string;
  background: string;
  logo: string | null;
}

export interface UserStats {
  libraryCount: number;
  friendsCount: number;
}

export interface UnlockedAchievement {
  name: string;
  unlockTime: number;
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
}

export interface ComparedAchievements {
  owner: {
    totalAchievementCount: number;
    unlockedAchievementCount: number;
  };
  target: {
    displayName: string;
    profileImageUrl: string;
    totalAchievementCount: number;
    unlockedAchievementCount: number;
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

export * from "./steam.types";
export * from "./real-debrid.types";
export * from "./ludusavi.types";
export * from "./how-long-to-beat.types";
export * from "./torbox.types";
