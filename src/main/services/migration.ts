import fs from "node:fs";
import path from "node:path";
import { SystemPath } from "./system-path";
import { XDGPath } from "./xdg-path";
import { logger } from "./logger";

const oldPaths = {
  userData: SystemPath.getPath("userData"),
};

const newPaths = {
  config: XDGPath.getPath("config"),
  data: XDGPath.getPath("data"),
  cache: XDGPath.getPath("cache"),
};

const moveDirectory = (source: string, destination: string) => {
  if (fs.existsSync(source)) {
    if (!fs.existsSync(destination)) {
      fs.mkdirSync(destination, { recursive: true });
    }
    fs.renameSync(source, path.join(destination, path.basename(source)));
  }
};

export const migrateToXDG = () => {
  logger.info("Checking for data migration to XDG paths...");

  const oldDbPath = path.join(oldPaths.userData, "hydra-db");
  const newDbPath = newPaths.config;
  moveDirectory(oldDbPath, newDbPath);

  const oldCommonRedistPath = path.join(oldPaths.userData, "CommonRedist");
  const newCommonRedistPath = path.join(newPaths.data, "CommonRedist");
  moveDirectory(oldCommonRedistPath, newCommonRedistPath);

  const oldLogsPath = path.join(oldPaths.userData, "logs");
  const newLogsPath = path.join(newPaths.cache, "logs");
  moveDirectory(oldLogsPath, newLogsPath);

  const oldBackupsPath = path.join(oldPaths.userData, "Backups");
  const newBackupsPath = path.join(newPaths.data, "Backups");
  moveDirectory(oldBackupsPath, newBackupsPath);

  const oldAssetsPath = path.join(oldPaths.userData, "Assets");
  const newAssetsPath = path.join(newPaths.data, "Assets");
  moveDirectory(oldAssetsPath, newAssetsPath);

  const oldThemesPath = path.join(oldPaths.userData, "themes");
  const newThemesPath = path.join(newPaths.data, "themes");
  moveDirectory(oldThemesPath, newThemesPath);

  logger.info("Data migration to XDG paths complete.");
};
