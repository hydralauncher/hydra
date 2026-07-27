import path from "node:path";
import fs from "node:fs";
import type { CloudBackupEntry, CloudStorageUsage, GameShop } from "@types";
import { gamesSublevel, levelKeys } from "@main/level";
import { YandexDiskBackup } from "./yandex-disk-backup";
import { logger } from "./logger";

/**
 * Facade used by the "Облачное хранилище" settings section.
 *
 * This service is intentionally thin: it does not talk to the Yandex
 * Disk API directly. All HTTP/token/auth plumbing continues to live in
 * YandexDiskBackup, which already owns the automatic backup/restore
 * flows and must not be duplicated or reimplemented here.
 */
export class CloudStorageService {
  public static async listBackups(): Promise<CloudBackupEntry[]> {
    return YandexDiskBackup.listAllBackups();
  }

  public static async getStorageUsage(): Promise<CloudStorageUsage> {
    return YandexDiskBackup.getStorageUsage();
  }

  public static async getDownloadUrl(remotePath: string): Promise<string> {
    return YandexDiskBackup.getResourceDownloadUrl(remotePath);
  }

  /**
   * Downloads a backup archive into a user-chosen folder, reporting
   * progress via onProgress (0-100). Returns the local file path.
   */
  public static async downloadBackup(
    remotePath: string,
    destDir: string,
    onProgress?: (percent: number) => void
  ): Promise<string> {
    const fileName = remotePath.split("/").pop() ?? "backup.tar.gz";
    const destPath = path.join(destDir, fileName);

    await YandexDiskBackup.downloadBackupToFile(
      remotePath,
      destPath,
      onProgress
    );

    return destPath;
  }

  /**
   * Restores a backup using the existing restore pipeline
   * (download archive -> Ludusavi.restoreGame -> cleanup). The target
   * game must still be present in the local library, since restoring
   * needs its wine prefix / shop metadata.
   */
  public static async restoreBackup(
    shop: GameShop,
    objectId: string,
    remotePath: string
  ): Promise<void> {
    const game = await gamesSublevel.get(levelKeys.game(shop, objectId));
    if (!game) {
      throw new Error("GAME_NOT_IN_LIBRARY");
    }

    await YandexDiskBackup.downloadAndRestoreBackup(game, remotePath);
  }

  public static async deleteBackup(remotePath: string): Promise<void> {
    await YandexDiskBackup.deleteBackupFile(remotePath);
  }

  public static async ensureDownloadDirExists(destDir: string): Promise<void> {
    try {
      fs.mkdirSync(destDir, { recursive: true });
    } catch (err) {
      logger.error("[CloudStorage] Failed to ensure download directory", err);
      throw err;
    }
  }
}
