import path from "node:path";
import fs from "node:fs";

import { registerEvent } from "../register-event";
import { downloadsSublevel, gamesSublevel, levelKeys } from "@main/level";
import type { GameShop, Game, Download } from "@types";
import { logger } from "@main/services";

// Directories that should never be scanned (too large or system-critical)
const UNSAFE_DIRECTORIES = [
  "C:\\",
  "C:\\Users",
  "C:\\Program Files",
  "C:\\Program Files (x86)",
  "C:\\Windows",
  "C:\\ProgramData",
  "/",
  "/home",
  "/usr",
  "/var",
  "/opt",
];

const isUnsafeDirectory = (dirPath: string): boolean => {
  const normalized = path.normalize(dirPath).replace(/[\\/]+$/, "");
  return UNSAFE_DIRECTORIES.some(
    (unsafe) => normalized.toLowerCase() === unsafe.toLowerCase()
  );
};

const getDownloadsPath = async (): Promise<string> => {
  const { app } = await import("electron");
  return app.getPath("downloads");
};

const getDirectorySize = async (dirPath: string): Promise<number> => {
  let totalSize = 0;

  try {
    const entries = await fs.promises.readdir(dirPath, { withFileTypes: true });

    for (const entry of entries) {
      const fullPath = path.join(dirPath, entry.name);

      try {
        if (entry.isDirectory()) {
          totalSize += await getDirectorySize(fullPath);
        } else if (entry.isFile()) {
          const stat = await fs.promises.stat(fullPath);
          totalSize += stat.size;
        }
      } catch {
        // Skip files that can't be accessed
      }
    }
  } catch {
    // Directory can't be read
  }

  return totalSize;
};

const getGameDiskUsage = async (
  _event: Electron.IpcMainInvokeEvent,
  shop: GameShop,
  objectId: string
) => {
  const gameKey = levelKeys.game(shop, objectId);

  let game: Game | undefined;
  let download: Download | undefined;

  try {
    game = await gamesSublevel.get(gameKey);
  } catch {
    // Game not found
  }

  try {
    download = await downloadsSublevel.get(gameKey);
  } catch {
    // Download not found
  }

  let installerSize: number | null = null;
  let installedSize: number | null = null;

  // Priority 1: Use Hydra-managed download folder
  if (download?.folderName) {
    const downloadsPath = download.downloadPath ?? (await getDownloadsPath());
    const gamePath = path.join(downloadsPath, download.folderName);

    try {
      if (fs.existsSync(gamePath)) {
        const stat = await fs.promises.stat(gamePath);

        if (stat.isDirectory()) {
          installedSize = await getDirectorySize(gamePath);
        } else if (stat.isFile()) {
          installerSize = stat.size;
        }
      }
    } catch (err) {
      logger.error("Error getting game path stats:", err);
    }
  }

  // Priority 2: Use executable directory (with safety check)
  if (game?.executablePath && !installedSize) {
    const executableDir = path.dirname(game.executablePath);

    if (!isUnsafeDirectory(executableDir)) {
      try {
        if (fs.existsSync(executableDir)) {
          const stat = await fs.promises.stat(executableDir);
          if (stat.isDirectory()) {
            installedSize = await getDirectorySize(executableDir);
          }
        }
      } catch (err) {
        logger.error("Error getting executable directory stats:", err);
      }
    }
  }

  // Priority 3: Wine prefix for Linux/macOS
  if (game?.winePrefixPath && !installedSize) {
    if (!isUnsafeDirectory(game.winePrefixPath)) {
      try {
        if (fs.existsSync(game.winePrefixPath)) {
          const stat = await fs.promises.stat(game.winePrefixPath);
          if (stat.isDirectory()) {
            installedSize = await getDirectorySize(game.winePrefixPath);
          }
        }
      } catch (err) {
        logger.error("Error getting wine prefix stats:", err);
      }
    }
  }

  return { installerSize, installedSize };
};

registerEvent("getGameDiskUsage", getGameDiskUsage);
