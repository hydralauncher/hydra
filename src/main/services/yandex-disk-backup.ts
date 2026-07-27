import path from "node:path";
import fs from "node:fs";
import os from "node:os";
import * as tar from "tar";
import axios from "axios";
import type {
  Game,
  GameShop,
  UserPreferences,
  UnlockedAchievement,
  CloudBackupEntry as CloudStorageBackupEntry,
  CloudStorageUsage,
} from "@types";
import { db, gamesSublevel, levelKeys } from "@main/level";
import { logger } from "./logger";
import { Ludusavi } from "./ludusavi";
import { SystemPath } from "./system-path";
import { BackupMetadataService } from "./backup-metadata";
import { AchievementMemoryStore } from "./achievements/achievement-memory-store";
import { mergeAchievements } from "./achievements/merge-achievements";

const YANDEX_DISK_API = "https://cloud-api.yandex.net/v1/disk";
const YANDEX_UPLOAD_API =
  "https://cloud-api.yandex.net/v1/disk/resources/upload";

/** Short requests: token/account checks, status pings. */
const REQUEST_TIMEOUT_SHORT_MS = 10_000;
/** Default requests: list/create/delete/get-download-url metadata calls. */
const REQUEST_TIMEOUT_DEFAULT_MS = 15_000;
/** Requests that transfer a file body (upload/download). */
const REQUEST_TIMEOUT_TRANSFER_MS = 120_000;
/** Page size for the flat file-listing endpoint used by listAllBackups(). */
const LIST_BACKUPS_PAGE_SIZE = 200;
/** Safety cap on how many items listAllBackups() will page through. */
const LIST_BACKUPS_MAX_OFFSET = 5_000;

export interface YandexBackupEntry {
  path: string;
  name: string;
  created: string;
  modified: string;
  size: number;
  type: string;
}

export class YandexDiskBackup {
  private static async getPrefs(): Promise<UserPreferences | null> {
    try {
      return await db.get<string, UserPreferences | null>(
        levelKeys.userPreferences,
        {
          valueEncoding: "json",
        }
      );
    } catch {
      return null;
    }
  }

  public static async validateToken(token: string): Promise<boolean> {
    try {
      const response = await axios.get(YANDEX_DISK_API, {
        headers: { Authorization: `OAuth ${token}` },
        timeout: REQUEST_TIMEOUT_SHORT_MS,
      });
      return response.status === 200;
    } catch {
      return false;
    }
  }

  private static async ensureRemoteDir(
    token: string,
    remotePath: string
  ): Promise<void> {
    const parts = remotePath.replace("disk:/", "").split("/").filter(Boolean);
    let current = "";
    for (const part of parts) {
      current = current ? `${current}/${part}` : part;
      try {
        await axios.put(`${YANDEX_DISK_API}/resources`, null, {
          params: { path: `disk:/${current}` },
          headers: { Authorization: `OAuth ${token}` },
          timeout: REQUEST_TIMEOUT_SHORT_MS,
        });
      } catch (err: any) {
        if (err?.response?.status !== 409) {
          // 409 means already exists, which is fine
          throw err;
        }
      }
    }
  }

  private static async uploadFile(
    token: string,
    localPath: string,
    remotePath: string
  ): Promise<void> {
    // Get upload URL
    const { data } = await axios.get(YANDEX_UPLOAD_API, {
      params: { path: remotePath, overwrite: true },
      headers: { Authorization: `OAuth ${token}` },
      timeout: REQUEST_TIMEOUT_DEFAULT_MS,
    });

    const uploadUrl: string = data.href;

    const fileBuffer = fs.readFileSync(localPath);
    await axios.put(uploadUrl, fileBuffer, {
      headers: { "Content-Type": "application/octet-stream" },
      maxBodyLength: Infinity,
      timeout: REQUEST_TIMEOUT_TRANSFER_MS,
    });
  }

  private static async downloadFile(
    token: string,
    remotePath: string,
    localPath: string
  ): Promise<void> {
    const { data } = await axios.get(`${YANDEX_DISK_API}/resources/download`, {
      params: { path: remotePath },
      headers: { Authorization: `OAuth ${token}` },
      timeout: REQUEST_TIMEOUT_DEFAULT_MS,
    });

    const downloadUrl: string = data.href;
    const response = await axios.get(downloadUrl, {
      responseType: "arraybuffer",
      timeout: REQUEST_TIMEOUT_TRANSFER_MS,
    });

    fs.writeFileSync(localPath, Buffer.from(response.data));
  }

  private static getRemoteGameDir(game: Game): string {
    return `disk:/HydraBackups/${game.shop}/${game.objectId}`;
  }

  public static async listBackups(
    game: Pick<Game, "objectId" | "shop">
  ): Promise<YandexBackupEntry[]> {
    const prefs = await this.getPrefs();
    const token = prefs?.yandexDiskToken;
    if (!token) return [];

    try {
      const remotePath = `disk:/HydraBackups/${game.shop}/${game.objectId}`;
      const { data } = await axios.get(`${YANDEX_DISK_API}/resources`, {
        params: { path: remotePath, limit: 100 },
        headers: { Authorization: `OAuth ${token}` },
        timeout: REQUEST_TIMEOUT_DEFAULT_MS,
      });

      const items: YandexBackupEntry[] = (data._embedded?.items ?? [])
        .filter((item: any) => item.name.endsWith(".tar.gz"))
        .map((item: any) => ({
          path: item.path,
          name: item.name,
          created: item.created,
          modified: item.modified,
          size: item.size ?? 0,
          type: item.type,
        }));

      return items.sort((a, b) => b.modified.localeCompare(a.modified));
    } catch (err: any) {
      if (err?.response?.status === 404) return [];
      logger.error("[YandexDisk] listBackups error", err);
      return [];
    }
  }

  public static async backupOnGameExit(game: Game): Promise<void> {
    const prefs = await this.getPrefs();
    if (!prefs?.yandexDiskBackupEnabled || !prefs?.yandexDiskToken) return;

    const token = prefs.yandexDiskToken;
    const maxBackups = prefs.yandexDiskMaxBackups ?? 5;
    const tmpDir = os.tmpdir();

    try {
      // Run Ludusavi backup to a temp directory
      const ludusaviTmpPath = path.join(
        tmpDir,
        `hydra-ydisk-${game.objectId}-${Date.now()}`
      );
      fs.mkdirSync(ludusaviTmpPath, { recursive: true });

      const ludusaviResult = await Ludusavi.backupGame(
        game.shop,
        game.objectId,
        ludusaviTmpPath,
        game.winePrefixPath
      );

      // Save Hydra metadata alongside Ludusavi backup files
      const metadata = BackupMetadataService.createMetadata(
        game,
        ludusaviResult
      );
      BackupMetadataService.writeMetadataToBackupDir(ludusaviTmpPath, metadata);

      // Create tar.gz
      const timestamp = new Date()
        .toISOString()
        .replace(/:/g, "-")
        .replace(/\..+/, "");
      const archiveName = `backup_${timestamp}.tar.gz`;
      const archivePath = path.join(tmpDir, archiveName);

      await tar.c({ gzip: true, file: archivePath, cwd: ludusaviTmpPath }, [
        ".",
      ]);

      // Ensure remote dir exists
      const remoteDir = this.getRemoteGameDir(game);
      await this.ensureRemoteDir(token, remoteDir);

      // Upload
      const remotePath = `${remoteDir}/${archiveName}`;
      await this.uploadFile(token, archivePath, remotePath);

      // Upload a lightweight metadata sidecar next to the archive so the
      // cloud storage manager can display game info without downloading
      // the whole archive. Purely additive — older backups simply won't
      // have this file, and everything else keeps working as before.
      try {
        const sidecarPath = path.join(tmpDir, `${archiveName}.metadata.json`);
        fs.writeFileSync(
          sidecarPath,
          JSON.stringify(metadata, null, 2),
          "utf-8"
        );
        await this.uploadFile(
          token,
          sidecarPath,
          `${remotePath}.metadata.json`
        );
        fs.rmSync(sidecarPath, { force: true });
      } catch (metaErr) {
        logger.warn(
          "[YandexDisk] Failed to upload metadata sidecar (non-fatal)",
          metaErr
        );
      }

      // Cleanup local tmp
      fs.rmSync(ludusaviTmpPath, { recursive: true, force: true });
      fs.rmSync(archivePath, { force: true });

      // Prune old backups
      const backups = await this.listBackups(game);
      if (backups.length > maxBackups) {
        const toDelete = backups.slice(maxBackups);
        for (const entry of toDelete) {
          try {
            await axios.delete(`${YANDEX_DISK_API}/resources`, {
              params: { path: entry.path, permanently: true },
              headers: { Authorization: `OAuth ${token}` },
              timeout: REQUEST_TIMEOUT_DEFAULT_MS,
            });
          } catch (e) {
            logger.warn("[YandexDisk] Failed to delete old backup", e);
          }
        }
      }

      logger.info(`[YandexDisk] Backup complete for ${game.title}`);

      // Backup achievements in parallel (non-blocking)
      this.backupAchievements(game).catch((e) =>
        logger.warn("[YandexDisk] backupAchievements error", e)
      );
    } catch (err) {
      logger.error("[YandexDisk] backupOnGameExit error", err);
    }
  }

  public static async downloadAndRestoreBackup(
    game: Pick<Game, "objectId" | "shop" | "winePrefixPath">,
    remotePath: string
  ): Promise<void> {
    const prefs = await this.getPrefs();
    const token = prefs?.yandexDiskToken;
    if (!token) throw new Error("Yandex Disk token not configured");

    const tmpDir = os.tmpdir();
    const archivePath = path.join(
      tmpDir,
      `hydra-restore-${game.objectId}-${Date.now()}.tar.gz`
    );
    const extractDir = path.join(tmpDir, `hydra-restore-extract-${Date.now()}`);

    try {
      fs.mkdirSync(extractDir, { recursive: true });

      await this.downloadFile(token, remotePath, archivePath);
      await tar.x({ file: archivePath, cwd: extractDir });

      await Ludusavi.restoreGame(
        game.shop,
        game.objectId,
        extractDir,
        game.winePrefixPath
      );

      // Check for cross-repack/emulator path compatibility
      const metadata =
        BackupMetadataService.readMetadataFromExtractDir(extractDir);
      if (metadata) {
        try {
          const currentPreview = await Ludusavi.backupGame(
            game.shop,
            game.objectId,
            null,
            game.winePrefixPath,
            true
          );
          const currentPaths = BackupMetadataService.extractSavePaths(
            currentPreview,
            game.objectId
          );
          const relocationResult = await BackupMetadataService.relocateSaves(
            metadata,
            currentPaths
          );
          if (relocationResult.relocated) {
            logger.info(
              `[YandexDisk] Relocated ${relocationResult.filesRelocated} save files: ` +
                `[${relocationResult.from.join(", ")}] → [${relocationResult.to.join(", ")}]`
            );
          }
        } catch (relocErr) {
          logger.warn(
            "[YandexDisk] Save relocation check failed (non-fatal)",
            relocErr
          );
        }
      }

      logger.info(`[YandexDisk] Restore complete for ${game.objectId}`);
    } finally {
      fs.rmSync(archivePath, { force: true });
      fs.rmSync(extractDir, { recursive: true, force: true });
    }
  }

  public static async checkAndRestoreOnStartup(): Promise<void> {
    const prefs = await this.getPrefs();
    if (!prefs?.yandexDiskRestoreOnStartup || !prefs?.yandexDiskToken) return;

    const token = prefs.yandexDiskToken;

    try {
      const allGames: Game[] = await gamesSublevel.values().all();

      for (const game of allGames) {
        if (game.isDeleted) continue;

        try {
          // Check local saves via Ludusavi preview
          const preview = await Ludusavi.getBackupPreview(
            game.shop,
            game.objectId,
            game.winePrefixPath
          );

          const hasLocalSaves =
            preview && Object.keys(preview.games ?? {}).length > 0;

          if (!hasLocalSaves) {
            const backups = await this.listBackups(game);
            if (backups.length > 0) {
              logger.info(`[YandexDisk] Restoring saves for ${game.title}`);
              await this.downloadAndRestoreBackup(game, backups[0].path);
            }
          }

          // Restore achievements
          await this.restoreAchievements(game, token);
        } catch (e) {
          logger.warn(
            `[YandexDisk] checkAndRestore failed for ${game.objectId}`,
            e
          );
        }
      }
    } catch (err) {
      logger.error("[YandexDisk] checkAndRestoreOnStartup error", err);
    }
  }

  public static async backupAchievements(game: Game): Promise<void> {
    const prefs = await this.getPrefs();
    const token = prefs?.yandexDiskToken;
    if (!token) return;

    try {
      const achievements: UnlockedAchievement[] =
        AchievementMemoryStore.get(game.shop, game.objectId)
          ?.unlockedAchievements ?? [];
      if (!achievements || achievements.length === 0) return;

      const remoteDir = this.getRemoteGameDir(game);
      await this.ensureRemoteDir(token, remoteDir);

      const tmpPath = path.join(
        os.tmpdir(),
        `hydra-ach-${game.objectId}-${Date.now()}.json`
      );
      fs.writeFileSync(tmpPath, JSON.stringify(achievements, null, 2));

      await this.uploadFile(token, tmpPath, `${remoteDir}/achievements.json`);
      fs.rmSync(tmpPath, { force: true });

      logger.info(`[YandexDisk] Achievements backed up for ${game.title}`);
    } catch (err) {
      logger.error("[YandexDisk] backupAchievements error", err);
    }
  }

  public static async restoreAchievements(
    game: Game,
    token: string
  ): Promise<void> {
    try {
      const remoteDir = this.getRemoteGameDir(game);
      const remotePath = `${remoteDir}/achievements.json`;

      const tmpPath = path.join(
        os.tmpdir(),
        `hydra-ach-restore-${game.objectId}-${Date.now()}.json`
      );

      try {
        await this.downloadFile(token, remotePath, tmpPath);
      } catch (e: any) {
        // 404 = no remote achievements, skip silently
        if (e?.response?.status === 404) return;
        throw e;
      }

      const achievements: UnlockedAchievement[] = JSON.parse(
        fs.readFileSync(tmpPath, "utf-8")
      );
      fs.rmSync(tmpPath, { force: true });

      if (!achievements || achievements.length === 0) return;

      const winePrefix = game.winePrefixPath;

      // Write Goldberg format: achievements.json
      const goldbergDir = this.findAchievementDir(game, "goldberg", winePrefix);
      if (goldbergDir) {
        const goldbergPath = path.join(goldbergDir, "achievements.json");
        if (!fs.existsSync(goldbergPath)) {
          const goldbergData: Record<
            string,
            { earned: number; earned_time: number }
          > = {};
          for (const ach of achievements) {
            goldbergData[ach.name] = {
              earned: 1,
              earned_time: ach.unlockTime
                ? Math.floor(new Date(ach.unlockTime).getTime() / 1000)
                : Math.floor(Date.now() / 1000),
            };
          }
          fs.writeFileSync(goldbergPath, JSON.stringify(goldbergData, null, 2));
        }
      }

      // Write CODEX format: achievements.ini
      const codexDir = this.findAchievementDir(game, "codex", winePrefix);
      if (codexDir) {
        const codexPath = path.join(codexDir, "achievements.ini");
        if (!fs.existsSync(codexPath)) {
          let iniContent = "[STATE]\n";
          for (const ach of achievements) {
            iniContent += `${ach.name}=1\n`;
          }
          fs.writeFileSync(codexPath, iniContent);
        }
      }

      // Write EMPRESS format (same as Goldberg)
      const empressDir = this.findAchievementDir(game, "empress", winePrefix);
      if (empressDir) {
        const empressPath = path.join(empressDir, "achievements.json");
        if (!fs.existsSync(empressPath)) {
          const empressData: Record<
            string,
            { earned: number; earned_time: number }
          > = {};
          for (const ach of achievements) {
            empressData[ach.name] = {
              earned: 1,
              earned_time: ach.unlockTime
                ? Math.floor(new Date(ach.unlockTime).getTime() / 1000)
                : Math.floor(Date.now() / 1000),
            };
          }
          fs.writeFileSync(empressPath, JSON.stringify(empressData, null, 2));
        }
      }

      // Merge into the in-memory achievement store (and sync with Hydra's
      // own backend if the game is linked) instead of writing to LevelDB,
      // which no longer persists achievements.
      await mergeAchievements(game, achievements, false);

      logger.info(`[YandexDisk] Achievements restored for ${game.title}`);
    } catch (err) {
      logger.warn("[YandexDisk] restoreAchievements error", err);
    }
  }

  private static findAchievementDir(
    game: Game,
    emulator: "goldberg" | "codex" | "empress",
    winePrefix?: string | null
  ): string | null {
    try {
      const appDataPath = SystemPath.getPath("appData");
      const candidates: string[] = [];

      if (process.platform === "win32") {
        // Windows paths
        const localAppData =
          process.env.LOCALAPPDATA ?? path.join(appDataPath, "..", "Local");
        candidates.push(
          path.join(localAppData, "CODEX", game.objectId),
          path.join(localAppData, "Goldberg SteamEmu", game.objectId),
          path.join(localAppData, "EMPRESS", game.objectId)
        );
      } else if (winePrefix) {
        // Wine prefix paths
        const wineLocal = path.join(
          winePrefix,
          "drive_c",
          "users",
          "steamuser",
          "Local Settings",
          "Application Data"
        );
        candidates.push(
          path.join(wineLocal, "CODEX", game.objectId),
          path.join(wineLocal, "Goldberg SteamEmu", game.objectId),
          path.join(wineLocal, "EMPRESS", game.objectId)
        );
      }

      for (const candidate of candidates) {
        const name = candidate.toLowerCase();
        if (
          (emulator === "goldberg" && name.includes("goldberg")) ||
          (emulator === "codex" && name.includes("codex")) ||
          (emulator === "empress" && name.includes("empress"))
        ) {
          if (fs.existsSync(candidate)) {
            return candidate;
          }
        }
      }
    } catch {
      // ignore
    }
    return null;
  }

  /* -----------------------------------------------------------------
   * The methods below are additive helpers used by CloudStorageService
   * (the "Облачное хранилище" settings section). They reuse the same
   * token/HTTP plumbing as the rest of this class but never touch the
   * automatic backup/restore/achievements flows above.
   * --------------------------------------------------------------- */

  public static async getToken(): Promise<string | null> {
    const prefs = await this.getPrefs();
    return prefs?.yandexDiskToken ?? null;
  }

  public static async getAccountInfo(): Promise<{
    login: string | null;
    displayName: string | null;
  } | null> {
    const token = await this.getToken();
    if (!token) return null;

    try {
      const { data } = await axios.get(YANDEX_DISK_API, {
        params: { fields: "user" },
        headers: { Authorization: `OAuth ${token}` },
        timeout: REQUEST_TIMEOUT_SHORT_MS,
      });

      return {
        login: data?.user?.login ?? null,
        displayName: data?.user?.display_name ?? null,
      };
    } catch {
      return null;
    }
  }

  private static async downloadTextFile(
    token: string,
    remotePath: string
  ): Promise<string> {
    const downloadUrl = await this.getResourceDownloadUrl(remotePath, token);
    const response = await axios.get(downloadUrl, {
      responseType: "text",
      timeout: REQUEST_TIMEOUT_DEFAULT_MS,
    });
    return typeof response.data === "string"
      ? response.data
      : JSON.stringify(response.data);
  }

  public static async getResourceDownloadUrl(
    remotePath: string,
    tokenOverride?: string
  ): Promise<string> {
    const token = tokenOverride ?? (await this.getToken());
    if (!token) throw new Error("Yandex Disk token not configured");

    const { data } = await axios.get(`${YANDEX_DISK_API}/resources/download`, {
      params: { path: remotePath },
      headers: { Authorization: `OAuth ${token}` },
      timeout: REQUEST_TIMEOUT_DEFAULT_MS,
    });

    return data.href;
  }

  public static async downloadBackupToFile(
    remotePath: string,
    destPath: string,
    onProgress?: (percent: number) => void
  ): Promise<void> {
    const token = await this.getToken();
    if (!token) throw new Error("Yandex Disk token not configured");

    const downloadUrl = await this.getResourceDownloadUrl(remotePath, token);

    const response = await axios.get(downloadUrl, {
      responseType: "stream",
      timeout: REQUEST_TIMEOUT_TRANSFER_MS,
      onDownloadProgress: (progressEvent) => {
        if (onProgress && progressEvent.total) {
          onProgress(
            Math.round((progressEvent.loaded / progressEvent.total) * 100)
          );
        }
      },
    });

    await new Promise<void>((resolve, reject) => {
      const writer = fs.createWriteStream(destPath);
      response.data.pipe(writer);
      writer.on("finish", () => resolve());
      writer.on("error", reject);
    });
  }

  public static async deleteBackupFile(remotePath: string): Promise<void> {
    const token = await this.getToken();
    if (!token) throw new Error("Yandex Disk token not configured");

    await axios.delete(`${YANDEX_DISK_API}/resources`, {
      params: { path: remotePath, permanently: true },
      headers: { Authorization: `OAuth ${token}` },
      timeout: REQUEST_TIMEOUT_DEFAULT_MS,
    });

    // Best-effort: the metadata sidecar may or may not exist.
    try {
      await axios.delete(`${YANDEX_DISK_API}/resources`, {
        params: { path: `${remotePath}.metadata.json`, permanently: true },
        headers: { Authorization: `OAuth ${token}` },
        timeout: REQUEST_TIMEOUT_DEFAULT_MS,
      });
    } catch {
      // ignore — sidecar may not exist (legacy backup)
    }
  }

  /**
   * Lists every backup archive under disk:/HydraBackups across all games,
   * for the unified cloud storage manager. Uses Yandex's flat file listing
   * endpoint (a single paginated call) rather than walking each game
   * folder individually.
   */
  public static async listAllBackups(): Promise<CloudStorageBackupEntry[]> {
    const token = await this.getToken();
    if (!token) return [];

    const rootPrefix = "disk:/HydraBackups/";

    try {
      const limit = LIST_BACKUPS_PAGE_SIZE;
      let offset = 0;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const rawItems: any[] = [];

      for (;;) {
        const { data } = await axios.get(`${YANDEX_DISK_API}/resources/files`, {
          params: { limit, offset, sort: "-modified" },
          headers: { Authorization: `OAuth ${token}` },
          timeout: REQUEST_TIMEOUT_DEFAULT_MS,
        });

        const items = data.items ?? [];
        rawItems.push(...items);

        if (items.length < limit || offset > LIST_BACKUPS_MAX_OFFSET) break;
        offset += limit;
      }

      const relevant = rawItems.filter(
        (item) =>
          typeof item.path === "string" && item.path.startsWith(rootPrefix)
      );

      const archives = relevant.filter((item) => item.name.endsWith(".tar.gz"));

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const sidecarByArchivePath = new Map<string, any>();
      for (const item of relevant) {
        if (item.name.endsWith(".tar.gz.metadata.json")) {
          sidecarByArchivePath.set(
            item.path.replace(/\.metadata\.json$/, ""),
            item
          );
        }
      }

      const allGames = await gamesSublevel.values().all();
      const gameTitleByKey = new Map<string, string>();
      for (const game of allGames) {
        gameTitleByKey.set(`${game.shop}:${game.objectId}`, game.title);
      }

      const entries: CloudStorageBackupEntry[] = [];

      for (const archive of archives) {
        const relativePath = archive.path.slice(rootPrefix.length);
        const parts = relativePath.split("/");
        if (parts.length < 2) continue;

        const shop = parts[0] as GameShop;
        const objectId = parts[1];

        let metadata: CloudStorageBackupEntry["metadata"] = null;
        const sidecarItem = sidecarByArchivePath.get(archive.path);

        if (sidecarItem) {
          try {
            const content = await this.downloadTextFile(
              token,
              sidecarItem.path
            );
            const parsed = JSON.parse(content);
            metadata = {
              gameName: parsed.gameName,
              steamAppId: parsed.steamAppId,
              gameVersion: parsed.gameVersion ?? null,
              platform: parsed.platform,
              backupDate: parsed.backupDate,
            };
          } catch (err) {
            logger.warn("[YandexDisk] Failed to read metadata sidecar", err);
          }
        }

        entries.push({
          path: archive.path,
          name: archive.name,
          shop,
          objectId,
          gameTitle:
            gameTitleByKey.get(`${shop}:${objectId}`) ??
            metadata?.gameName ??
            objectId,
          created: archive.created,
          modified: archive.modified,
          size: archive.size ?? 0,
          metadata,
        });
      }

      return entries.sort((a, b) => b.modified.localeCompare(a.modified));
    } catch (err) {
      logger.error("[YandexDisk] listAllBackups error", err);
      return [];
    }
  }

  public static async getStorageUsage(): Promise<CloudStorageUsage> {
    const token = await this.getToken();
    if (!token) {
      return { totalSpace: 0, usedSpace: 0, backupsSize: 0, backupsCount: 0 };
    }

    const [diskInfo, backups] = await Promise.all([
      axios
        .get(YANDEX_DISK_API, {
          headers: { Authorization: `OAuth ${token}` },
          timeout: REQUEST_TIMEOUT_SHORT_MS,
        })
        .then((response) => response.data)
        .catch(() => null),
      this.listAllBackups(),
    ]);

    const backupsSize = backups.reduce(
      (sum, entry) => sum + (entry.size ?? 0),
      0
    );

    return {
      totalSpace: diskInfo?.total_space ?? 0,
      usedSpace: diskInfo?.used_space ?? 0,
      backupsSize,
      backupsCount: backups.length,
    };
  }
}
