import { registerEvent } from "../register-event";
import type { Download, StartGameDownloadPayload } from "@types";
import { DownloadManager, HydraApi, logger } from "@main/services";
import { createGame } from "@main/services/library-sync";
import {
  downloadsSublevel,
  gamesShopAssetsSublevel,
  gamesSublevel,
  levelKeys,
} from "@main/level";
import { Downloader, DownloadError, parseBytes } from "@shared";
import { AxiosError } from "axios";

const addGameToQueue = async (
  _event: Electron.IpcMainInvokeEvent,
  payload: StartGameDownloadPayload
) => {
  const {
    objectId,
    title,
    shop,
    downloadPath,
    downloader,
    uri,
    automaticallyExtract,
    fileSize,
  } = payload;

  const gameKey = levelKeys.game(shop, objectId);

  const download: Download = {
    shop,
    objectId,
    status: "paused",
    progress: 0,
    bytesDownloaded: 0,
    downloadPath,
    downloader,
    uri,
    folderName: null,
    fileSize: parseBytes(fileSize ?? null),
    shouldSeed: false,
    timestamp: Date.now(),
    queued: true,
    extracting: false,
    automaticallyExtract,
    extractionProgress: 0,
  };

  try {
    await DownloadManager.validateDownloadUrl(download);
  } catch (err: unknown) {
    logger.error("Failed to validate download URL for queue", err);

    if (err instanceof AxiosError) {
      if (err.response?.status === 429 && downloader === Downloader.Gofile) {
        return { ok: false, error: DownloadError.GofileQuotaExceeded };
      }

      if (
        err.response?.status === 403 &&
        downloader === Downloader.RealDebrid
      ) {
        return {
          ok: false,
          error: DownloadError.RealDebridAccountNotAuthorized,
        };
      }

      if (downloader === Downloader.TorBox) {
        return { ok: false, error: err.response?.data?.detail };
      }
    }

    if (err instanceof Error) {
      if (downloader === Downloader.Buzzheavier) {
        if (err.message.includes("Rate limit")) {
          return { ok: false, error: "Buzzheavier: Rate limit exceeded" };
        }
        if (
          err.message.includes("not found") ||
          err.message.includes("deleted")
        ) {
          return { ok: false, error: "Buzzheavier: File not found" };
        }
      }

      if (downloader === Downloader.FuckingFast) {
        if (err.message.includes("Rate limit")) {
          return { ok: false, error: "FuckingFast: Rate limit exceeded" };
        }
        if (
          err.message.includes("not found") ||
          err.message.includes("deleted")
        ) {
          return { ok: false, error: "FuckingFast: File not found" };
        }
      }

      return { ok: false, error: err.message };
    }

    return { ok: false };
  }

  const game = await gamesSublevel.get(gameKey);
  const gameAssets = await gamesShopAssetsSublevel.get(gameKey);

  await downloadsSublevel.del(gameKey);

  if (game) {
    await gamesSublevel.put(gameKey, {
      ...game,
      isDeleted: false,
    });
  } else {
    await gamesSublevel.put(gameKey, {
      title,
      iconUrl: gameAssets?.iconUrl ?? null,
      libraryHeroImageUrl: gameAssets?.libraryHeroImageUrl ?? null,
      logoImageUrl: gameAssets?.logoImageUrl ?? null,
      objectId,
      shop,
      remoteId: null,
      playTimeInMilliseconds: 0,
      lastTimePlayed: null,
      isDeleted: false,
    });
  }

  try {
    await downloadsSublevel.put(gameKey, download);

    const updatedGame = await gamesSublevel.get(gameKey);

    await Promise.all([
      createGame(updatedGame!).catch(() => {}),
      HydraApi.post(`/games/${shop}/${objectId}/download`, null, {
        needsAuth: false,
      }).catch(() => {}),
    ]);

    return { ok: true };
  } catch (err: unknown) {
    logger.error("Failed to add game to queue", err);

    if (err instanceof Error) {
      return { ok: false, error: err.message };
    }

    return { ok: false };
  }
};

registerEvent("addGameToQueue", addGameToQueue);
