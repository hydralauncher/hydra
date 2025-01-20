import type { Downloader } from "@shared";
import type {
  GameShop,
  GameStatus,
  SteamAchievement,
  UnlockedAchievement,
} from "./game.types";

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
}

export interface Download {
  shop: GameShop;
  objectId: string;
  uri: string;
  folderName: string;
  downloadPath: string;
  progress: number;
  downloader: Downloader;
  bytesDownloaded: number;
  playTimeInMilliseconds: number;
  lastTimePlayed: Date | null;
  fileSize: number;
  shouldSeed: boolean;
  // TODO: Rename to DownloadStatus
  status: GameStatus | null;
  timestamp: number;
}

export interface GameAchievement {
  achievements: SteamAchievement[];
  unlockedAchievements: UnlockedAchievement[];
}
