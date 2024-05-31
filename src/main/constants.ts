import { app } from "electron";
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
  "TinyRepacks",
  "CPG",
  "GOG",
  "onlinefix",
] as const;

export const defaultDownloadsPath = app.getPath("downloads");

export const databasePath = path.join(
  app.getPath("appData"),
  "hydra",
  "hydra.db"
);

export const logsPath = path.join(app.getPath("appData"), "hydra", "logs");

export const releasesPageUrl = "https://github.com/hydralauncher/hydra";

export const seedsPath = app.isPackaged
  ? path.join(process.resourcesPath, "seeds")
  : path.join(__dirname, "..", "..", "seeds");
