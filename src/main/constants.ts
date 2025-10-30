import { app } from "electron";
import path from "node:path";
import { SystemPath } from "./services/system-path";

export const defaultDownloadsPath = SystemPath.getPath("downloads");

export const isStaging = import.meta.env.MAIN_VITE_API_URL.includes("staging");

export const windowsStartMenuPath = path.join(
  SystemPath.getPath("appData"),
  "Microsoft",
  "Windows",
  "Start Menu",
  "Programs"
);

export const publicProfilePath = "C:/Users/Public";

export const levelDatabasePath = path.join(
  SystemPath.getPath("userData"),
  `hydra-db${isStaging ? "-staging" : ""}`
);

export const commonRedistPath = path.join(
  SystemPath.getPath("userData"),
  "CommonRedist"
);

export const logsPath = path.join(
  SystemPath.getPath("userData"),
  `logs${isStaging ? "-staging" : ""}`
);

export const achievementSoundPath = app.isPackaged
  ? path.join(process.resourcesPath, "achievement.wav")
  : path.join(__dirname, "..", "..", "resources", "achievement.wav");

export const backupsPath = path.join(SystemPath.getPath("userData"), "Backups");

export const appVersion = app.getVersion() + (isStaging ? "-staging" : "");

export const ASSETS_PATH = path.join(SystemPath.getPath("userData"), "Assets");

export const MAIN_LOOP_INTERVAL = 2000;

export const DECKY_PLUGINS_LOCATION = path.join(
  SystemPath.getPath("home"),
  "homebrew",
  "plugins"
);

export const HYDRA_DECKY_PLUGIN_LOCATION = path.join(
  DECKY_PLUGINS_LOCATION,
  "Hydra"
);
