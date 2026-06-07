import { registerEvent } from "../register-event";
import { downloadsSublevel, gamesSublevel, levelKeys } from "@main/level";
import { DownloadManager } from "@main/services/download/download-manager";
import { Downloader } from "@shared";
import fs from "node:fs";

import { logger } from "@main/services";
import type { Download, GameShop } from "@types";

const verifyGameIntegrity = async (
  _event: Electron.IpcMainInvokeEvent,
  shop: GameShop,
  objectId: string,
  fallbackUri?: string,
  fallbackDownloadPath?: string
) => {
  const gameKey = levelKeys.game(shop, objectId);
  logger.info(`[VerifyIntegrity] Called for ${gameKey}`);

  let download = await downloadsSublevel.get(gameKey).catch(() => null);
  const game = await gamesSublevel.get(gameKey).catch(() => null);

  if (!game) {
    logger.error(`[VerifyIntegrity] Game not found in DB for ${gameKey}`);
    throw new Error("Game not found in database.");
  }

  // If there's no download entry but we have fallback info (uri + path), create a minimal one
  if (!download) {
    const uri = fallbackUri;
    const downloadPath = fallbackDownloadPath;

    if (uri && downloadPath) {
      logger.info(
        `[VerifyIntegrity] No download entry found, creating from fallback uri for ${gameKey}`
      );

      const isTorrent = uri.startsWith("magnet:") || uri.endsWith(".torrent");

      const newDownload: Download = {
        shop,
        objectId,
        uri,
        downloadPath,
        folderName: null,
        progress: 0,
        downloader: isTorrent ? Downloader.Torrent : Downloader.RealDebrid,
        bytesDownloaded: 0,
        fileSize: null,
        shouldSeed: false,
        status: "paused",
        queued: false,
        pinnedToHero: false,
        timestamp: Date.now(),
        extracting: false,
        automaticallyExtract: false,
        automaticallyDeleteArchiveFiles: false,
      };

      await downloadsSublevel.put(gameKey, newDownload);
      download = newDownload;
      logger.info(`[VerifyIntegrity] Created download entry for ${gameKey}`);
    } else {
      // No fallback: check if the executable at least exists
      logger.error(
        `[VerifyIntegrity] Download not found in DB for ${gameKey} and no fallback provided`
      );

      if (game.executablePath && fs.existsSync(game.executablePath)) {
        logger.info(
          `[VerifyIntegrity] Executable exists, cannot run torrent recheck without uri`
        );
        throw new Error(
          "No download found. Go to the Downloads tab in game options to run verification with the torrent source."
        );
      }
      throw new Error(
        "Download not found in database. Please restart the download first."
      );
    }
  }

  logger.info(`[VerifyIntegrity] Downloader type: ${download.downloader}`);

  // Torrent logic: trigger force_recheck via python RPC
  if (download.downloader === Downloader.Torrent) {
    logger.info(`[VerifyIntegrity] Triggering forceRecheck for ${gameKey}`);
    await DownloadManager.forceRecheck(gameKey);
    return true;
  }

  // Direct download logic: Basic existence check
  if (game.executablePath) {
    if (!fs.existsSync(game.executablePath)) {
      logger.error(
        `[VerifyIntegrity] Executable missing: ${game.executablePath}`
      );
      throw new Error(
        "The executable is missing. If this is a non-torrent game, please re-download it."
      );
    }
    return true;
  }

  throw new Error("Unable to verify the integrity of this game.");
};

registerEvent("verifyGameIntegrity", verifyGameIntegrity);
