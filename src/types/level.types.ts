import type { Downloader } from "@shared";
import type {
  GameShop,
  SteamAchievement,
  UnlockedAchievement,
} from "./game.types";
import type { DownloadStatus } from "./download.types";

export type SubscriptionStatus = "active" | "pending" | "cancelled";

export interface Subscription {
  id: string;
  status: SubscriptionStatus;
  plan: { id: string; name: string };
  expiresAt: string | null;
  paymentMethod: "pix" | "paypal";
}

export interface Auth {
  accessToken: string;
  refreshToken: string;
  tokenExpirationTimestamp: number;
}

export interface User {
  id: string;
  displayName: string;
  profileImageUrl: string | null;
  backgroundImageUrl: string | null;
  subscription: Subscription | null;
}

export interface Game {
  title: string;
  iconUrl: string | null;
  playTimeInMilliseconds: number;
  lastTimePlayed: Date | null;
  objectId: string;
  shop: GameShop;
  remoteId: string | null;
  isDeleted: boolean;
  winePrefixPath?: string | null;
  executablePath?: string | null;
  launchOptions?: string | null;
  favorite?: boolean;
  automaticCloudSync?: boolean;
}

export interface Download {
  shop: GameShop;
  objectId: string;
  uri: string;
  folderName: string | null;
  downloadPath: string;
  progress: number;
  downloader: Downloader;
  bytesDownloaded: number;
  fileSize: number | null;
  shouldSeed: boolean;
  status: DownloadStatus | null;
  queued: boolean;
  timestamp: number;
  extracting: boolean;
  automaticallyExtract: boolean;
}

export interface GameAchievement {
  achievements: SteamAchievement[];
  unlockedAchievements: UnlockedAchievement[];
}

export interface UserPreferences {
  downloadsPath?: string | null;
  language?: string;
  realDebridApiToken?: string | null;
  torBoxApiToken?: string | null;
  preferQuitInsteadOfHiding?: boolean;
  runAtStartup?: boolean;
  startMinimized?: boolean;
  disableNsfwAlert?: boolean;
  enableAutoInstall?: boolean;
  seedAfterDownloadComplete?: boolean;
  showHiddenAchievementsDescription?: boolean;
  downloadNotificationsEnabled?: boolean;
  repackUpdatesNotificationsEnabled?: boolean;
  achievementNotificationsEnabled?: boolean;
  friendRequestNotificationsEnabled?: boolean;
  showDownloadSpeedInMegabits?: boolean;
}

export interface ScreenState {
  x?: number;
  y?: number;
  height: number;
  width: number;
  isMaximized: boolean;
}
