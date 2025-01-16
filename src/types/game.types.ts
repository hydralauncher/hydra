import type { Downloader } from "@shared";

export type GameStatus =
  | "active"
  | "waiting"
  | "paused"
  | "error"
  | "complete"
  | "seeding"
  | "removed";

export type GameShop = "steam" | "epic";

export interface Game {
  // TODO: To be depreacted
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
  launchOptions: string | null;
  lastTimePlayed: Date | null;
  uri: string | null;
  fileSize: number;
  objectID: string;
  shop: GameShop;
  //   downloadQueue: DownloadQueue | null;
  downloadQueue: any | null;
  shouldSeed: boolean;
  createdAt: Date;
  updatedAt: Date;
}

export interface UnlockedAchievement {
  name: string;
  unlockTime: number;
}

export interface SteamAchievement {
  name: string;
  displayName: string;
  description?: string;
  icon: string;
  icongray: string;
  hidden: boolean;
  points?: number;
}

export interface UserAchievement extends SteamAchievement {
  unlocked: boolean;
  unlockTime: number | null;
}
