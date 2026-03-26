import axios from "axios";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import * as tar from "tar";
import type {
  GameShop,
  LudusaviBackupMapping,
  UserPreferences,
  WebDavBackupEntry,
} from "@types";
import { db, gamesSublevel, levelKeys } from "@main/level";
import { logger } from "./logger";
import { WindowManager } from "./window-manager";
import { CloudSync } from "./cloud-sync";
import { Wine } from "./wine";
import { backupsPath, publicProfilePath } from "@main/constants";
import { addTrailingSlash, normalizePath } from "@main/helpers";
import YAML from "yaml";

const transformBackupPathIntoWindowsPath = (
  backupPath: string,
  winePrefixPath?: string | null
) => {
  return backupPath
    .replace(winePrefixPath ? addTrailingSlash(winePrefixPath) : "", "")
    .replace("drive_c", "C:");
};

const addWinePrefixToWindowsPath = (
  windowsPath: string,
  winePrefixPath?: string | null
) => {
  if (!winePrefixPath) {
    return windowsPath;
  }
  return path.join(winePrefixPath, windowsPath.replace("C:", "drive_c"));
};

export class WebDavBackup {
  private static readonly metadataFilename = ".hydra-backups-metadata.json";

  private static normalizeRemotePath(remotePath: string) {
    const normalized = remotePath.trim();
    if (!normalized) return "";
    return normalized.startsWith("/") ? normalized : `/${normalized}`;
  }

  private static buildUrl(host: string, remotePath: string) {
    const base = host.endsWith("/") ? host.slice(0, -1) : host;
    const normalized = this.normalizeRemotePath(remotePath);
    return `${base}${normalized}`;
  }

  private static getMetadataPath(gameDir: string) {
    return this.normalizeRemotePath(`${gameDir}/${this.metadataFilename}`);
  }

  private static getDeleteHrefCandidates(href: string): string[] {
    const candidates = new Set<string>();
    let normalizedHref = href.trim();

    if (normalizedHref.length === 0) {
      return [];
    }

    const addEncodedAndDecoded = (value: string) => {
      candidates.add(value);
      try {
        candidates.add(decodeURIComponent(value));
      } catch {
        // ignore malformed URI components
      }
      candidates.add(encodeURI(value));
    };

    if (/^https?:\/\//i.test(normalizedHref)) {
      try {
        const parsed = new URL(normalizedHref);
        normalizedHref = `${parsed.pathname}${parsed.search}`;
      } catch {
        return [];
      }
    }

    addEncodedAndDecoded(normalizedHref);

    return Array.from(candidates);
  }

  private static async ensureDirectory(
    host: string,
    remotePath: string,
    username: string,
    password: string
  ) {
    const url = this.buildUrl(host, remotePath);
    try {
      await axios.request({
        method: "MKCOL",
        url,
        auth: { username, password },
        validateStatus: (status) =>
          (status >= 200 && status < 300) || status === 405,
      });
    } catch (err) {
      logger.warn(`WebDAV MKCOL failed for ${url}`, err);
    }
  }

  private static parsePropfindListing(xml: string): WebDavBackupEntry[] {
    const entries: WebDavBackupEntry[] = [];

    const responseRegex =
      /<[^:>\s]+:response\b[^>]*>([\s\S]*?)<\/[^:>\s]+:response>/gi;

    let match: RegExpExecArray | null;
    while ((match = responseRegex.exec(xml)) !== null) {
      const block = match[1];

      // Skip directories
      if (/<[^:>\s]+:collection\b/i.test(block)) continue;

      const hrefMatch = block.match(
        /<[^:>\s]+:href[^>]*>([\s\S]*?)<\/[^:>\s]+:href>/i
      );
      if (!hrefMatch) continue;

      const href = hrefMatch[1].trim();

      // Only include .tar files
      if (!href.endsWith(".tar")) continue;

      const rawFilename = href.split("/").pop() ?? href;
      let filename = rawFilename;
      try {
        filename = decodeURIComponent(rawFilename);
      } catch {
        filename = rawFilename;
      }

      const sizeMatch = block.match(
        /<[^:>\s]+:getcontentlength[^>]*>([\s\S]*?)<\/[^:>\s]+:getcontentlength>/i
      );
      const sizeInBytes = sizeMatch ? parseInt(sizeMatch[1].trim()) || 0 : 0;

      const modifiedMatch = block.match(
        /<[^:>\s]+:getlastmodified[^>]*>([\s\S]*?)<\/[^:>\s]+:getlastmodified>/i
      );
      const createdAt = modifiedMatch ? modifiedMatch[1].trim() : "";

      entries.push({ href, filename, sizeInBytes, createdAt });
    }

    return entries.sort((a, b) => {
      const dateA = a.createdAt ? new Date(a.createdAt).getTime() : 0;
      const dateB = b.createdAt ? new Date(b.createdAt).getTime() : 0;
      return dateB - dateA;
    });
  }

  private static normalizeBackupEntries(entries: unknown): WebDavBackupEntry[] {
    if (!Array.isArray(entries)) return [];

    return entries
      .map((entry): WebDavBackupEntry | null => {
        if (!entry || typeof entry !== "object") return null;

        const {
          href,
          filename,
          sizeInBytes,
          createdAt,
          hostname,
          downloadOptionTitle,
        } = entry as Record<string, unknown>;
        const normalizedHref =
          typeof href === "string" ? this.normalizeRemotePath(href) : "";
        const normalizedFilename = typeof filename === "string" ? filename : "";
        const normalizedSize =
          typeof sizeInBytes === "number" && Number.isFinite(sizeInBytes)
            ? Math.max(0, sizeInBytes)
            : 0;
        const normalizedCreatedAt =
          typeof createdAt === "string" ? createdAt : "";
        const normalizedHostname =
          typeof hostname === "string" ? hostname.trim() : "";
        const normalizedDownloadOptionTitle =
          typeof downloadOptionTitle === "string"
            ? downloadOptionTitle
            : downloadOptionTitle === null
              ? null
              : null;

        if (!normalizedHref || !normalizedFilename) return null;
        if (!normalizedFilename.endsWith(".tar")) return null;

        return {
          href: normalizedHref,
          filename: normalizedFilename,
          sizeInBytes: normalizedSize,
          createdAt: normalizedCreatedAt,
          hostname: normalizedHostname || undefined,
          downloadOptionTitle: normalizedDownloadOptionTitle,
        };
      })
      .filter((entry): entry is WebDavBackupEntry => entry !== null);
  }

  private static sortEntriesByDate(entries: WebDavBackupEntry[]) {
    return [...entries].sort((a, b) => {
      const dateA = a.createdAt ? new Date(a.createdAt).getTime() : 0;
      const dateB = b.createdAt ? new Date(b.createdAt).getTime() : 0;
      return dateB - dateA;
    });
  }

  private static async readMetadata(
    host: string,
    gameDir: string,
    username: string,
    password: string
  ): Promise<WebDavBackupEntry[] | null> {
    const metadataPath = this.getMetadataPath(gameDir);
    const metadataUrl = this.buildUrl(host, metadataPath);

    const response = await axios
      .get(metadataUrl, {
        auth: { username, password },
        responseType: "text",
        validateStatus: (status) =>
          (status >= 200 && status < 300) || status === 404,
      })
      .catch((err) => {
        logger.warn("Failed to read WebDAV metadata file", {
          metadataUrl,
          err,
        });
        return null;
      });

    if (!response || response.status === 404) {
      return null;
    }

    try {
      const metadata = JSON.parse(String(response.data)) as {
        backups?: unknown;
      };

      return this.sortEntriesByDate(
        this.normalizeBackupEntries(metadata?.backups ?? [])
      );
    } catch (err) {
      logger.warn("Failed to parse WebDAV metadata file", { metadataUrl, err });
      return null;
    }
  }

  private static async writeMetadata(
    host: string,
    gameDir: string,
    username: string,
    password: string,
    backups: WebDavBackupEntry[]
  ) {
    const metadataPath = this.getMetadataPath(gameDir);
    const metadataUrl = this.buildUrl(host, metadataPath);

    await axios.put(
      metadataUrl,
      JSON.stringify(
        {
          version: 1,
          updatedAt: new Date().toISOString(),
          backups: this.sortEntriesByDate(this.normalizeBackupEntries(backups)),
        },
        null,
        2
      ),
      {
        auth: { username, password },
        headers: { "Content-Type": "application/json" },
      }
    );
  }

  private static async upsertMetadataEntry(
    host: string,
    gameDir: string,
    username: string,
    password: string,
    entry: WebDavBackupEntry
  ) {
    const currentEntries =
      (await this.readMetadata(host, gameDir, username, password)) ?? [];
    const normalizedEntry = this.normalizeBackupEntries([entry])[0];

    if (!normalizedEntry) return;

    const merged = currentEntries.filter(
      (backup) =>
        backup.href !== normalizedEntry.href &&
        backup.filename !== normalizedEntry.filename
    );
    merged.push(normalizedEntry);

    await this.writeMetadata(host, gameDir, username, password, merged);
  }

  private static async removeMetadataEntry(
    host: string,
    gameDir: string,
    username: string,
    password: string,
    href: string
  ) {
    const currentEntries = await this.readMetadata(
      host,
      gameDir,
      username,
      password
    );
    if (!currentEntries) return;

    const hrefCandidates = this.getDeleteHrefCandidates(href).map((candidate) =>
      this.normalizeRemotePath(candidate)
    );
    const hrefSet = new Set(hrefCandidates);

    const filtered = currentEntries.filter((entry) => !hrefSet.has(entry.href));

    if (filtered.length === currentEntries.length) return;

    await this.writeMetadata(host, gameDir, username, password, filtered);
  }

  private static restoreBackup(
    backupPath: string,
    objectId: string,
    homeDir: string,
    winePrefixPath?: string | null
  ) {
    const gameBackupPath = path.join(backupPath, objectId);
    const mappingYamlPath = path.join(gameBackupPath, "mapping.yaml");

    const data = fs.readFileSync(mappingYamlPath, "utf8");
    const manifest = YAML.parse(data) as {
      backups: LudusaviBackupMapping[];
      drives: Record<string, string>;
    };

    const userProfilePath =
      CloudSync.getWindowsLikeUserProfilePath(winePrefixPath);

    manifest.backups.forEach((backup) => {
      Object.keys(backup.files).forEach((key) => {
        const sourcePathWithDrives = Object.entries(manifest.drives).reduce(
          (prev, [driveKey, driveValue]) => {
            return prev.replace(driveValue, driveKey);
          },
          key
        );

        const sourcePath = path.join(gameBackupPath, sourcePathWithDrives);

        logger.info(`WebDAV restore source path: ${sourcePath}`);

        const destinationPath = transformBackupPathIntoWindowsPath(
          key,
          winePrefixPath
        )
          .replace(
            homeDir,
            addWinePrefixToWindowsPath(userProfilePath, winePrefixPath)
          )
          .replace(
            publicProfilePath,
            addWinePrefixToWindowsPath(publicProfilePath, winePrefixPath)
          );

        logger.info(`WebDAV restore destination path: ${destinationPath}`);

        fs.mkdirSync(path.dirname(destinationPath), { recursive: true });

        if (fs.existsSync(destinationPath)) {
          fs.unlinkSync(destinationPath);
        }

        fs.renameSync(sourcePath, destinationPath);
      });
    });
  }

  public static async testConnection(
    host: string,
    username: string,
    password: string
  ) {
    const url = host.endsWith("/") ? host : `${host}/`;
    await axios.request({
      method: "PROPFIND",
      url,
      auth: { username, password },
      headers: { Depth: "0" },
      validateStatus: (status) =>
        (status >= 200 && status < 300) || status === 207,
    });
  }

  public static isConfigured(preferences: UserPreferences | null) {
    return Boolean(
      preferences?.webDavHost &&
        preferences?.webDavUsername &&
        preferences?.webDavPassword
    );
  }

  public static async listBackups(
    objectId: string,
    shop: GameShop
  ): Promise<WebDavBackupEntry[]> {
    const preferences = await db
      .get<string, UserPreferences>(levelKeys.userPreferences, {
        valueEncoding: "json",
      })
      .catch(() => null);

    if (!WebDavBackup.isConfigured(preferences)) {
      return [];
    }

    const { webDavHost, webDavUsername, webDavPassword, webDavLocation } =
      preferences!;

    const location = (webDavLocation ?? "/hydra-backups").replace(/\/$/, "");
    const gameDir = `${location}/${shop}-${objectId}`;
    const metadataBackups = await WebDavBackup.readMetadata(
      webDavHost!,
      gameDir,
      webDavUsername!,
      webDavPassword!
    );

    if (metadataBackups) {
      return metadataBackups;
    }

    const url = WebDavBackup.buildUrl(webDavHost!, gameDir);

    const response = await axios.request({
      method: "PROPFIND",
      url,
      auth: { username: webDavUsername!, password: webDavPassword! },
      headers: { Depth: "1", "Content-Type": "application/xml" },
      validateStatus: (status) =>
        (status >= 200 && status < 300) || status === 207 || status === 404,
    });

    if (response.status === 404) return [];

    const listedBackups = WebDavBackup.parsePropfindListing(
      response.data as string
    );

    if (listedBackups.length > 0) {
      WebDavBackup.writeMetadata(
        webDavHost!,
        gameDir,
        webDavUsername!,
        webDavPassword!,
        listedBackups
      ).catch((err) => {
        logger.warn(
          "Failed to seed WebDAV metadata file from PROPFIND listing",
          {
            gameDir,
            err,
          }
        );
      });
    }

    return listedBackups;
  }

  public static async downloadAndRestoreBackup(
    objectId: string,
    shop: GameShop,
    href: string
  ): Promise<void> {
    const preferences = await db
      .get<string, UserPreferences>(levelKeys.userPreferences, {
        valueEncoding: "json",
      })
      .catch(() => null);

    if (!WebDavBackup.isConfigured(preferences)) {
      throw new Error("WebDAV not configured");
    }

    const { webDavHost, webDavUsername, webDavPassword } = preferences!;

    const game = await gamesSublevel.get(levelKeys.game(shop, objectId));
    const effectiveWinePrefixPath = Wine.getEffectivePrefixPath(
      game?.winePrefixPath,
      objectId
    );

    const homeDir = normalizePath(
      CloudSync.getWindowsLikeUserProfilePath(effectiveWinePrefixPath)
    );

    const downloadUrl = WebDavBackup.buildUrl(webDavHost!, href);

    const filename = href.split("/").pop() ?? `${objectId}.tar`;
    const zipLocation = path.join(backupsPath, filename);
    const backupRestorePath = path.join(backupsPath, `${shop}-${objectId}`);

    if (fs.existsSync(backupRestorePath)) {
      fs.rmSync(backupRestorePath, { recursive: true, force: true });
    }

    try {
      const response = await axios.get(downloadUrl, {
        responseType: "stream",
        auth: { username: webDavUsername!, password: webDavPassword! },
        onDownloadProgress: (progressEvent) => {
          WindowManager.mainWindow?.webContents.send(
            `on-webdav-backup-download-progress-${objectId}-${shop}`,
            progressEvent
          );
        },
      });

      await new Promise<void>((resolve, reject) => {
        const writer = fs.createWriteStream(zipLocation);
        response.data.pipe(writer);
        writer.on("error", reject);
        writer.on("close", resolve);
      });

      fs.mkdirSync(backupRestorePath, { recursive: true });

      await tar.x({ file: zipLocation, cwd: backupRestorePath });

      WebDavBackup.restoreBackup(
        backupRestorePath,
        objectId,
        homeDir,
        effectiveWinePrefixPath
      );

      WindowManager.mainWindow?.webContents.send(
        `on-webdav-backup-download-complete-${objectId}-${shop}`,
        true
      );

      logger.info(
        `WebDAV backup restored for ${shop}-${objectId} from ${href}`
      );
    } catch (err) {
      logger.error("Failed to download/restore WebDAV backup", err);

      WindowManager.mainWindow?.webContents.send(
        `on-webdav-backup-download-complete-${objectId}-${shop}`,
        false
      );
    } finally {
      try {
        if (fs.existsSync(zipLocation)) {
          await fs.promises.unlink(zipLocation);
        }
      } catch (err) {
        logger.error("Failed to remove WebDAV restore tar file", {
          zipLocation,
          err,
        });
      }
    }
  }

  public static async deleteBackup(
    objectId: string,
    shop: GameShop,
    href: string
  ): Promise<void> {
    const preferences = await db
      .get<string, UserPreferences>(levelKeys.userPreferences, {
        valueEncoding: "json",
      })
      .catch(() => null);

    if (!WebDavBackup.isConfigured(preferences)) {
      throw new Error("WebDAV not configured");
    }

    const { webDavHost, webDavUsername, webDavPassword, webDavLocation } =
      preferences!;
    const location = (webDavLocation ?? "/hydra-backups").replace(/\/$/, "");
    const gameDir = `${location}/${shop}-${objectId}`;

    const hrefCandidates = WebDavBackup.getDeleteHrefCandidates(href);
    let lastStatus = 404;

    for (const hrefCandidate of hrefCandidates) {
      const deleteUrl = WebDavBackup.buildUrl(webDavHost!, hrefCandidate);

      const response = await axios.request({
        method: "DELETE",
        url: deleteUrl,
        auth: { username: webDavUsername!, password: webDavPassword! },
        validateStatus: (status) =>
          (status >= 200 && status < 300) || status === 404,
      });

      if (response.status >= 200 && response.status < 300) {
        await WebDavBackup.removeMetadataEntry(
          webDavHost!,
          gameDir,
          webDavUsername!,
          webDavPassword!,
          href
        ).catch((err) => {
          logger.warn("Failed to update WebDAV metadata after delete", {
            href,
            gameDir,
            err,
          });
        });
        return;
      }

      lastStatus = response.status;
    }

    if (lastStatus === 404) {
      throw new Error("WebDAV backup not found");
    }
  }

  public static async renameBackup(
    objectId: string,
    shop: GameShop,
    href: string,
    label: string
  ): Promise<string> {
    const sanitizedLabel = label.trim();
    if (!sanitizedLabel) {
      throw new Error("WebDAV backup label is required");
    }

    const preferences = await db
      .get<string, UserPreferences>(levelKeys.userPreferences, {
        valueEncoding: "json",
      })
      .catch(() => null);

    if (!WebDavBackup.isConfigured(preferences)) {
      throw new Error("WebDAV not configured");
    }

    const { webDavHost, webDavUsername, webDavPassword, webDavLocation } =
      preferences!;
    const location = (webDavLocation ?? "/hydra-backups").replace(/\/$/, "");
    const gameDir = `${location}/${shop}-${objectId}`;

    const filename = `${sanitizedLabel}.tar`;
    const encodedFilename = encodeURIComponent(filename);
    const destinationPath = WebDavBackup.normalizeRemotePath(
      `${gameDir}/${encodedFilename}`
    );
    const destinationUrl = WebDavBackup.buildUrl(webDavHost!, destinationPath);

    const hrefCandidates = WebDavBackup.getDeleteHrefCandidates(href);
    let movedFromPath = "";
    let lastStatus = 404;

    for (const hrefCandidate of hrefCandidates) {
      const sourcePath = WebDavBackup.normalizeRemotePath(hrefCandidate);
      const sourceUrl = WebDavBackup.buildUrl(webDavHost!, sourcePath);

      const response = await axios.request({
        method: "MOVE",
        url: sourceUrl,
        auth: { username: webDavUsername!, password: webDavPassword! },
        headers: {
          Destination: destinationUrl,
          Overwrite: "T",
        },
        validateStatus: (status) =>
          (status >= 200 && status < 300) || status === 404,
      });

      if (response.status >= 200 && response.status < 300) {
        movedFromPath = sourcePath;
        break;
      }

      lastStatus = response.status;
    }

    if (!movedFromPath) {
      if (lastStatus === 404) {
        throw new Error("WebDAV backup not found");
      }

      throw new Error("WebDAV backup rename failed");
    }

    const currentEntries = await WebDavBackup.readMetadata(
      webDavHost!,
      gameDir,
      webDavUsername!,
      webDavPassword!
    );

    if (currentEntries) {
      const hrefSet = new Set(
        WebDavBackup.getDeleteHrefCandidates(href).map((candidate) =>
          WebDavBackup.normalizeRemotePath(candidate)
        )
      );

      const updatedEntries = currentEntries.map((entry) => {
        if (!hrefSet.has(entry.href) && entry.href !== movedFromPath) {
          return entry;
        }

        return {
          ...entry,
          href: destinationPath,
          filename,
        };
      });

      await WebDavBackup.writeMetadata(
        webDavHost!,
        gameDir,
        webDavUsername!,
        webDavPassword!,
        updatedEntries
      ).catch((err) => {
        logger.warn("Failed to update WebDAV metadata after rename", {
          href,
          destinationPath,
          gameDir,
          err,
        });
      });
    }

    return destinationPath;
  }

  public static async uploadSaveGame(
    objectId: string,
    shop: GameShop,
    downloadOptionTitle: string | null,
    label?: string
  ) {
    const preferences = await db
      .get<string, UserPreferences>(levelKeys.userPreferences, {
        valueEncoding: "json",
      })
      .catch(() => null);

    if (!WebDavBackup.isConfigured(preferences)) {
      throw new Error("WebDAV not configured");
    }

    const { webDavHost, webDavUsername, webDavPassword, webDavLocation } =
      preferences!;

    const location = (webDavLocation ?? "/hydra-backups").replace(/\/$/, "");
    const gameDir = `${location}/${shop}-${objectId}`;

    const game = await gamesSublevel.get(levelKeys.game(shop, objectId));
    const effectiveWinePrefixPath = Wine.getEffectivePrefixPath(
      game?.winePrefixPath,
      objectId
    );

    const bundleLocation = await CloudSync.bundleBackup(
      shop,
      objectId,
      effectiveWinePrefixPath
    );

    try {
      await WebDavBackup.ensureDirectory(
        webDavHost!,
        location,
        webDavUsername!,
        webDavPassword!
      );

      await WebDavBackup.ensureDirectory(
        webDavHost!,
        gameDir,
        webDavUsername!,
        webDavPassword!
      );

      const sanitizedLabel = (label ?? "").trim();
      const filename = `${sanitizedLabel || CloudSync.getBackupLabel(false)}.tar`;
      const encodedFilename = encodeURIComponent(filename);
      const uploadPath = WebDavBackup.normalizeRemotePath(
        `${gameDir}/${encodedFilename}`
      );
      const uploadUrl = WebDavBackup.buildUrl(webDavHost!, uploadPath);

      const fileBuffer = await fs.promises.readFile(bundleLocation);

      await axios.put(uploadUrl, fileBuffer, {
        auth: { username: webDavUsername!, password: webDavPassword! },
        headers: { "Content-Type": "application/octet-stream" },
        maxBodyLength: Infinity,
        maxContentLength: Infinity,
      });

      await WebDavBackup.upsertMetadataEntry(
        webDavHost!,
        gameDir,
        webDavUsername!,
        webDavPassword!,
        {
          href: uploadPath,
          filename,
          sizeInBytes: fileBuffer.byteLength,
          createdAt: new Date().toISOString(),
          hostname: os.hostname(),
          downloadOptionTitle,
        }
      ).catch((err) => {
        logger.warn("Failed to update WebDAV metadata after upload", {
          uploadPath,
          gameDir,
          err,
        });
      });

      WindowManager.mainWindow?.webContents.send(
        `on-upload-complete-${objectId}-${shop}`,
        true
      );

      logger.info(
        `WebDAV backup uploaded for ${shop}-${objectId}: ${uploadPath}`
      );
    } finally {
      try {
        await fs.promises.unlink(bundleLocation);
      } catch (err) {
        logger.error("Failed to remove WebDAV tar file", {
          bundleLocation,
          err,
        });
      }
    }
  }
}
