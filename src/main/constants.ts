import { app } from "electron";
import os from "node:os";
import path from "node:path";

export const repackersOn1337x = [
  "DODI",
  "FitGirl",
  "0xEMPRESS",
  "KaOsKrew",
  "TinyRepacks",
] as const;

export const repackers = [
  ...repackersOn1337x,
  "Xatab",
  "CPG",
  "TinyRepacks",
  "GOG",
] as const;

export const months = [
  "Jan",
  "Feb",
  "Mar",
  "Apr",
  "May",
  "Jun",
  "Jul",
  "Aug",
  "Sep",
  "Oct",
  "Nov",
  "Dec",
];

export enum GameStatus {
  Seeding = "seeding",
  Downloading = "downloading",
  Paused = "paused",
  CheckingFiles = "checking_files",
  DownloadingMetadata = "downloading_metadata",
  Cancelled = "cancelled",
}

export const defaultDownloadsPath = path.join(os.homedir(), "downloads");

export const databasePath = path.join(
  app.getPath("appData"),
  app.getName(),
  "hydra.db"
);

export const INSTALLATION_ID_LENGTH = 6;
export const ACTIVATION_KEY_MULTIPLIER = 7;
