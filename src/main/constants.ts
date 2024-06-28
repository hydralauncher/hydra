import { app } from "electron";
import path from "node:path";

export const defaultDownloadsPath = app.getPath("downloads");

export const databasePath = path.join(
  app.getPath("appData"),
  "hydra",
  "hydra.db"
);

export const logsPath = path.join(app.getPath("appData"), "hydra", "logs");

export const seedsPath = app.isPackaged
  ? path.join(process.resourcesPath, "seeds")
  : path.join(__dirname, "..", "..", "seeds");

export const windowsStartupPath = path.join(
  app.getPath("appData"),
  "Microsoft",
  "Windows",
  "Start Menu",
  "Programs",
  "Startup"
);
