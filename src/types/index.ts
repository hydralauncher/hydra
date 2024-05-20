import type { Downloader } from "@shared";
import type { Aria2Status } from "aria2";

export type GameShop = "steam" | "epic";
export type CatalogueCategory = "recently_added" | "trending";

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
  screenshots: SteamScreenshot[];
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
  magnet: string;
  page: number;
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

/* Used by the library */
export interface Game extends Omit<CatalogueEntry, "cover"> {
  id: number;
  title: string;
  iconUrl: string;
  status: Aria2Status | null;
  folderName: string;
  downloadPath: string | null;
  repacks: GameRepack[];
  repack: GameRepack | null;
  progress: number;
  bytesDownloaded: number;
  playTimeInMilliseconds: number;
  downloader: Downloader;
  executablePath: string | null;
  lastTimePlayed: Date | null;
  fileSize: number;
  createdAt: Date;
  updatedAt: Date;
}

export interface DownloadProgress {
  downloadSpeed: number;
  timeRemaining: number;
  numPeers: number;
  numSeeds: number;
  downloadingMetadata: boolean;
  progress: number;
  bytesDownloaded: number;
  fileSize: number;
  game: Omit<Game, "repacks">;
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
