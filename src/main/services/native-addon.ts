import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";

import { app } from "electron";
import type { ProcessPayload, LibtorrentPayload } from "./download/types";
import type { TorrentFilesResponse } from "@types";

import { logger } from "./logger";

type NativeProcessProfileImageResponse = {
  imagePath?: string;
  image_path?: string;
  mimeType?: string;
  mime_type?: string;
};

type HydraNativeModule = {
  processProfileImage: (
    imagePath: string,
    targetExtension?: string
  ) => NativeProcessProfileImageResponse;
  listProcesses: () => ProcessPayload[];
  torrentGetStatus: () => LibtorrentPayload | null;
  torrentGetSeedStatus: () => Array<LibtorrentPayload & { gameId: string }>;
  torrentGetFiles: (
    magnet: string,
    timeoutMs?: number
  ) => Promise<TorrentFilesResponse>;
  torrentStart: (payload: {
    gameId: string;
    url: string;
    savePath: string;
    fileIndices?: number[];
    timeoutMs?: number;
  }) => Promise<void>;
  torrentPause: (gameId: string) => void;
  torrentCancel: (gameId: string) => void;
  torrentResumeSeeding: (payload: {
    gameId: string;
    url: string;
    savePath: string;
  }) => void;
  torrentPauseSeeding: (gameId: string) => void;
  torrentSetDownloadLimit: (
    maxDownloadSpeedBytesPerSecond?: number | null
  ) => void;
  torrentBackend?: () => string;
};

export class NativeAddon {
  private static nativeModule: HydraNativeModule | null = null;

  private static resolveAddonPath() {
    if (app.isPackaged) {
      return path.join(
        process.resourcesPath,
        "hydra-native",
        "hydra-native.node"
      );
    }

    return path.join(app.getAppPath(), "hydra-native", "hydra-native.node");
  }

  private static load() {
    if (this.nativeModule) return this.nativeModule;

    const addonPath = this.resolveAddonPath();
    const addonDir = path.dirname(addonPath);

    if (!fs.existsSync(addonPath)) {
      throw new Error(`Hydra native addon not found at ${addonPath}`);
    }

    if (process.platform === "linux") {
      process.env.LD_LIBRARY_PATH = process.env.LD_LIBRARY_PATH
        ? `${addonDir}:${process.env.LD_LIBRARY_PATH}`
        : addonDir;
    }

    const require = createRequire(import.meta.url);
    const nativeModule = require(addonPath) as HydraNativeModule;

    try {
      const backend = nativeModule.torrentBackend?.();
      if (backend === "libtorrent") {
        logger.log(`[NativeAddon] Torrent backend: ${backend}`);
      } else if (backend) {
        throw new Error(
          `Unsupported native torrent backend '${backend}'. Expected 'libtorrent'.`
        );
      } else if (!app.isPackaged) {
        throw new Error(
          "Native addon does not expose torrent backend identifier. This usually means a stale hydra-native.node build. Rebuild with `npm run build:native` after installing libtorrent dev packages."
        );
      } else {
        logger.warn(
          "[NativeAddon] Torrent backend identifier unavailable (stale native addon binary?)"
        );
      }
    } catch (error) {
      logger.error("[NativeAddon] Failed backend validation", error);
      throw error;
    }

    this.nativeModule = nativeModule;

    return nativeModule;
  }

  public static processProfileImage(
    imagePath: string,
    targetExtension = "webp"
  ) {
    try {
      const response = this.load().processProfileImage(
        imagePath,
        targetExtension
      );

      const normalizedImagePath = response.imagePath ?? response.image_path;
      const normalizedMimeType = response.mimeType ?? response.mime_type;

      if (!normalizedImagePath || !normalizedMimeType) {
        throw new Error("Hydra native addon returned an invalid payload");
      }

      return {
        imagePath: normalizedImagePath,
        mimeType: normalizedMimeType,
      };
    } catch (error) {
      logger.error("Failed to process profile image via native addon", error);
      throw error;
    }
  }

  public static listProcesses(): ProcessPayload[] {
    try {
      const response = this.load().listProcesses();

      if (!Array.isArray(response)) {
        throw new Error("Hydra native addon returned an invalid process list");
      }

      return response.filter((process): process is ProcessPayload => {
        return (
          typeof process?.pid === "number" &&
          typeof process?.name === "string" &&
          process.name.length > 0
        );
      });
    } catch (error) {
      logger.error("Failed to list processes via native addon", error);
      return [];
    }
  }

  public static getTorrentStatus(): LibtorrentPayload | null {
    return this.load().torrentGetStatus();
  }

  public static getTorrentSeedStatus(): Array<
    LibtorrentPayload & { gameId: string }
  > {
    return this.load().torrentGetSeedStatus();
  }

  public static async getTorrentFiles(
    magnet: string,
    timeoutMs?: number
  ): Promise<TorrentFilesResponse> {
    return this.load().torrentGetFiles(magnet, timeoutMs);
  }

  public static async startTorrentDownload(payload: {
    gameId: string;
    url: string;
    savePath: string;
    fileIndices?: number[];
    timeoutMs?: number;
  }) {
    return this.load().torrentStart(payload);
  }

  public static pauseTorrentDownload(gameId: string) {
    this.load().torrentPause(gameId);
  }

  public static cancelTorrentDownload(gameId: string) {
    this.load().torrentCancel(gameId);
  }

  public static resumeTorrentSeeding(payload: {
    gameId: string;
    url: string;
    savePath: string;
  }) {
    this.load().torrentResumeSeeding(payload);
  }

  public static pauseTorrentSeeding(gameId: string) {
    this.load().torrentPauseSeeding(gameId);
  }

  public static setTorrentDownloadLimit(
    maxDownloadSpeedBytesPerSecond?: number | null
  ) {
    this.load().torrentSetDownloadLimit(maxDownloadSpeedBytesPerSecond);
  }
}
