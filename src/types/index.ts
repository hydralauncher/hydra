import type { DownloadSourceStatus, Downloader } from "@shared";

export type GameStatus =
  | "active"
  | "waiting"
  | "paused"
  | "error"
  | "complete"
  | "removed";

export type GameShop = "steam" | "epic";

export type FriendRequestAction = "ACCEPTED" | "REFUSED" | "CANCEL";

export interface SteamGenre {
  id: string;
  name: string;
}

export interface SteamScreenshot {
  id: number;
  path_thumbnail: string;
  path_full: string;
}

export interface SteamVideoSource {
  max: string;
  "480": string;
}

export interface SteamMovies {
  id: number;
  mp4: SteamVideoSource;
  webm: SteamVideoSource;
  thumbnail: string;
  name: string;
  highlight: boolean;
}

export interface SteamAppDetails {
  name: string;
  detailed_description: string;
  about_the_game: string;
  short_description: string;
  publishers: string[];
  genres: SteamGenre[];
  movies?: SteamMovies[];
  screenshots?: SteamScreenshot[];
  pc_requirements: {
    minimum: string;
    recommended: string;
  };
  mac_requirements: {
    minimum: string;
    recommended: string;
  };
  linux_requirements: {
    minimum: string;
    recommended: string;
  };
  release_date: {
    coming_soon: boolean;
    date: string;
  };
}

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
  repacks: GameRepack[];
}

export interface UserGame {
  objectID: string;
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
  repacks: GameRepack[];
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

export interface UserDetails {
  id: string;
  displayName: string;
  profileImageUrl: string | null;
}

export interface UserFriend {
  id: string;
  displayName: string;
  profileImageUrl: string | null;
}

export interface UserFriends {
  totalFriends: number;
  friends: UserFriend[];
}

export interface UserBlocks {
  totalBlocks: number;
  blocks: UserFriend[];
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

export interface UserProfile {
  id: string;
  displayName: string;
  profileImageUrl: string | null;
  profileVisibility: "PUBLIC" | "PRIVATE" | "FRIENDS";
  totalPlayTimeInSeconds: number;
  libraryGames: UserGame[];
  recentGames: UserGame[];
  friends: UserFriend[];
  totalFriends: number;
  relation: UserRelation | null;
  currentGame: GameRunning | null;
}

export interface UpdateProfileProps {
  displayName?: string;
  profileVisibility?: "PUBLIC" | "PRIVATE" | "FRIENDS";
  profileImageUrl?: string | null;
  bio?: string;
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

export interface CommunitySource {
  key: string;
  label: string;
  value: string;
}
