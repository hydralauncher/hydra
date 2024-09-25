import type { DownloadSourceStatus, Downloader } from "@shared";
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

export type ShopDetails = SteamAppDetails & {
  objectID: string;
};

export interface TorrentFile {
  path: string;
  length: number;
}

/* Used by the catalogue */
export interface CatalogueEntry {
  objectID: string;
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
  realDebridApiToken: string | null;
  preferQuitInsteadOfHiding: boolean;
  runAtStartup: boolean;
}

export interface HowLongToBeatCategory {
  title: string;
  duration: string;
  accuracy: string;
}

export interface Steam250Game {
  title: string;
  objectID: string;
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
  objectID: string;
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

export interface UserProfileCurrentGame extends Omit<GameRunning, "objectID"> {
  objectId: string;
  sessionDurationInSeconds: number;
}

export type ProfileVisibility = "PUBLIC" | "PRIVATE" | "FRIENDS";

export interface UserDetails {
  id: string;
  username: string;
  displayName: string;
  profileImageUrl: string | null;
  profileVisibility: ProfileVisibility;
  bio: string;
}

export interface UserProfile {
  id: string;
  displayName: string;
  profileImageUrl: string | null;
  profileVisibility: ProfileVisibility;
  libraryGames: UserGame[];
  recentGames: UserGame[];
  friends: UserFriend[];
  totalFriends: number;
  relation: UserRelation | null;
  currentGame: UserProfileCurrentGame | null;
  bio: string;
}

export interface UpdateProfileRequest {
  displayName?: string;
  profileVisibility?: ProfileVisibility;
  profileImageUrl?: string | null;
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
  downloads: DownloadSourceDownload[];
  etag: string;
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

export interface GameArtifact {
  id: string;
  artifactLengthInBytes: number;
  createdAt: string;
  updatedAt: string;
  hostname: string;
  downloadCount: number;
}

export * from "./steam.types";
export * from "./real-debrid.types";
export * from "./ludusavi.types";
