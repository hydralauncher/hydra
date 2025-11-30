import { app } from "electron";
import path from "node:path";
import { SystemPath } from "./services/system-path";
import { XDGPath } from "./services/xdg-path";

export const defaultDownloadsPath = SystemPath.getPath("downloads");

export const isStaging =
  import.meta.env?.MAIN_VITE_API_URL?.includes("staging") ?? false;

export const windowsStartMenuPath = path.join(
  SystemPath.getPath("appData"),
  "Microsoft",
  "Windows",
  "Start Menu",
  "Programs"
);

export const publicProfilePath = "C:/Users/Public";

export const levelDatabasePath = path.join(
  XDGPath.getPath("config"),
  `hydra-db${isStaging ? "-staging" : ""}`
);

export const commonRedistPath = path.join(
  XDGPath.getPath("data"),
  "CommonRedist"
);

export const logsPath = path.join(
  XDGPath.getPath("cache"),
  `logs${isStaging ? "-staging" : ""}`
);

export const achievementSoundPath = app.isPackaged
  ? path.join(process.resourcesPath, "achievement.wav")
  : path.join(__dirname, "..", "..", "resources", "achievement.wav");

export const backupsPath = path.join(XDGPath.getPath("data"), "Backups");

export const appVersion = app.getVersion() + (isStaging ? "-staging" : "");

export const ASSETS_PATH = path.join(XDGPath.getPath("data"), "Assets");

export const THEMES_PATH = path.join(XDGPath.getPath("data"), "themes");

export const MAIN_LOOP_INTERVAL = 2000;

export const DEFAULT_ACHIEVEMENT_SOUND_VOLUME = 0.15;

export const DECKY_PLUGINS_LOCATION = path.join(
  SystemPath.getPath("home"),
  "homebrew",
  "plugins"
);

export const HYDRA_DECKY_PLUGIN_LOCATION = path.join(
  DECKY_PLUGINS_LOCATION,
  "Hydra"
);
