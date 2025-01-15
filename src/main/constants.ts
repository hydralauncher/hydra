import { app } from "electron";
import path from "node:path";

export const LUDUSAVI_MANIFEST_URL = "https://cdn.losbroxas.org/manifest.yaml";

export const defaultDownloadsPath = app.getPath("downloads");

export const isStaging = import.meta.env.MAIN_VITE_API_URL.includes("staging");

export const levelDatabasePath = path.join(
  app.getPath("userData"),
  `hydra-db${isStaging ? "-staging" : ""}`
);

export const databaseDirectory = path.join(app.getPath("appData"), "hydra");
export const databasePath = path.join(
  databaseDirectory,
  isStaging ? "hydra_test.db" : "hydra.db"
);

export const logsPath = path.join(app.getPath("userData"), "hydra", "logs");

export const seedsPath = app.isPackaged
  ? path.join(process.resourcesPath, "seeds")
  : path.join(__dirname, "..", "..", "seeds");

export const achievementSoundPath = app.isPackaged
  ? path.join(process.resourcesPath, "achievement.wav")
  : path.join(__dirname, "..", "..", "resources", "achievement.wav");

export const backupsPath = path.join(app.getPath("userData"), "Backups");

export const appVersion = app.getVersion() + (isStaging ? "-staging" : "");
