import { app } from "electron";
import path from "node:path";

export const defaultDownloadsPath = app.getPath("downloads");

export const databaseDirectory = path.join(app.getPath("appData"), "hydra");
export const databasePath = path.join(databaseDirectory, "hydra.db");

export const logsPath = path.join(app.getPath("appData"), "hydra", "logs");

export const seedsPath = app.isPackaged
  ? path.join(process.resourcesPath, "seeds")
  : path.join(__dirname, "..", "..", "seeds");

export const appVersion = app.getVersion();
