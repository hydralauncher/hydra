import type { Cracker, DownloadSourceStatus, Downloader } from "@shared";
import type { SteamAppDetails } from "./steam.types";

export type GameStatus =
  | "active"
  | "waiting"
  | "paused"
  | "error"
  | "complete"
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

export interface UserPreferences {
  downloadsPath: string | null;
  language: string;
  downloadNotificationsEnabled: boolean;
  repackUpdatesNotificationsEnabled: boolean;
  achievementNotificationsEnabled: boolean;
  realDebridApiToken: string | null;
  torboxApiToken: string | null;
  preferQuitInsteadOfHiding: boolean;
  runAtStartup: boolean;
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

export interface RealDebridUnrestrictLink {
  id: string;
  filename: string;
  mimeType: string;
  filesize: number;
  link: string;
  host: string;
  host_icon: string;
  chunks: number;
  crc: number;
  download: string;
  streamable: number;
}

export interface RealDebridAddMagnet {
  id: string;
  // URL of the created ressource
  uri: string;
}

export interface RealDebridTorrentInfo {
  id: string;
  filename: string;
  original_filename: string;
  hash: string;
  bytes: number;
  original_bytes: number;
  host: string;
  split: number;
  progress: number;
  status:
    | "magnet_error"
    | "magnet_conversion"
    | "waiting_files_selection"
    | "queued"
    | "downloading"
    | "downloaded"
    | "error"
    | "virus"
    | "compressing"
    | "uploading"
    | "dead";
  added: string;
  files: {
    id: number;
    path: string;
    bytes: number;
    selected: number;
  }[];
  links: string[];
  ended: string;
  speed: number;
  seeders: number;
}

export interface RealDebridUser {
  id: number;
  username: string;
  email: string;
  points: number;
  locale: string;
  avatar: string;
  type: string;
  premium: number;
  expiration: string;
}

export interface TorBoxUser {
  id: number;
  email: string;
  plan: string;
  expiration: string;
}

export interface TorBoxUserRequest {
  success: boolean;
  detail: string;
  error: string;
  data: TorBoxUser;
}

export interface TorBoxFile {
  id: number;
  md5: string;
  s3_path: string;
  name: string;
  size: number;
  mimetype: string;
  short_name: string;
}

export interface TorBoxTorrentInfo {
  id: number;
  hash: string;
  created_at: string;
  updated_at: string;
  magnet: string;
  size: number;
  active: boolean;
  cached: boolean;
  auth_id: string;
  download_state:
    | "downloading"
    | "uploading"
    | "stalled (no seeds)"
    | "paused"
    | "completed"
    | "cached"
    | "metaDL"
    | "checkingResumeData";
  seeds: number;
  ratio: number;
  progress: number;
  download_speed: number;
  upload_speed: number;
  name: string;
  eta: number;
  files: TorBoxFile[];
}

export interface TorBoxTorrentInfoRequest {
  success: boolean;
  detail: string;
  error: string;
  data: TorBoxTorrentInfo[];
}

export interface TorBoxAddTorrentRequest {
  success: boolean;
  detail: string;
  error: string;
  data: {
    torrent_id: number;
    name: string;
    hash: string;
  };
}

export interface TorBoxRequestLinkRequest {
  success: boolean;
  detail: string;
  error: string;
  data: string;
}

export interface UserDetails {
  id: string;
  displayName: string;
  profileImageUrl: string | null;
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
}

export interface UserDetails {
  id: string;
  username: string;
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
export * from "./howlongtobeat.types";
