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
    throw new Error("Jeu introuvable dans la base de données.");
  }

  // If there's no download entry but we have fallback info (uri + path), create a minimal one
  if (!download) {
    const uri = fallbackUri;
    const downloadPath = fallbackDownloadPath;

    if (uri && downloadPath) {
      logger.info(
        `[VerifyIntegrity] No download entry found, creating from fallback uri for ${gameKey}`
      );

      const newDownload: Download = {
        shop: shop as any,
        objectId,
        uri,
        downloadPath,
        folderName: null,
        progress: 0,
        downloader: Downloader.Torrent,
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
          "Aucun téléchargement trouvé. Allez dans les options du jeu, onglet Téléchargements, pour lancer la vérification avec la source torrent."
        );
      }
      throw new Error(
        "Téléchargement introuvable dans la base de données. Relancez d'abord le téléchargement."
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
        "L'exécutable est manquant. Si c'est un jeu sans Torrent, veuillez le re-télécharger."
      );
    }
    return true;
  }

  throw new Error("Impossible de vérifier l'intégrité de ce jeu.");
};

registerEvent("verifyGameIntegrity", verifyGameIntegrity);
