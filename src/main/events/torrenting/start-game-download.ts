import { registerEvent } from "../register-event";
import type { Download, StartGameDownloadPayload } from "@types";
import { DownloadManager, HydraApi, logger } from "@main/services";
import { createGame } from "@main/services/library-sync";
import { Downloader, DownloadError, getDownloadersForUri } from "@shared";
import {
  downloadsSublevel,
  gamesShopAssetsSublevel,
  gamesSublevel,
  levelKeys,
} from "@main/level";
import { AxiosError } from "axios";

const startGameDownload = async (
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
  } = payload;

  const gameKey = levelKeys.game(shop, objectId);

  const validDownloaders = getDownloadersForUri(uri);
  if (validDownloaders.length === 0) {
    return {
      ok: false,
      error: "No download options available for this source",
    };
  }
  if (!validDownloaders.includes(downloader)) {
    return {
      ok: false,
      error: "Selected download option is not compatible with this source",
    };
  }

  await DownloadManager.pauseDownload();

  for await (const [key, value] of downloadsSublevel.iterator()) {
    if (value.status === "active" && value.progress !== 1) {
      await downloadsSublevel.put(key, {
        ...value,
        status: "paused",
      });
    }
  }

  const game = await gamesSublevel.get(gameKey);
  const gameAssets = await gamesShopAssetsSublevel.get(gameKey);

  /* Delete any previous download */
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

  await DownloadManager.cancelDownload(gameKey);

  const download: Download = {
    shop,
    objectId,
    status: "active",
    progress: 0,
    bytesDownloaded: 0,
    downloadPath,
    downloader,
    uri,
    folderName: null,
    fileSize: null,
    shouldSeed: false,
    timestamp: Date.now(),
    queued: true,
    extracting: false,
    automaticallyExtract,
  };

    try {
      await DownloadManager.startDownload(download).then(() => {
        return downloadsSublevel.put(gameKey, download);
      });

      const updatedGame = await gamesSublevel.get(gameKey);

      await Promise.all([
        createGame(updatedGame!).catch(() => {}),
        HydraApi.post(`/games/${shop}/${objectId}/download`, null, {
          needsAuth: false,
        }).catch(() => {}),
      ]);

      return { ok: true };
    } catch (err: unknown) {
      logger.error("Failed to start download", err);

      if (err instanceof AxiosError) {
        // Handle connection errors (Python RPC service not running on macos)
        if (!err.response) {
          const errorCode = (err as any).code;
          if (errorCode === "ECONNREFUSED") {
            return {
              ok: false,
              error: "Python RPC service is not available. The service may have crashed. Please try downloading again or restart the application.",
            };
          }
          return {
            ok: false,
            error: `Connection error: ${err.message || "Unknown error"}`,
          };
        }

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

        return {
          ok: false,
          error: err.response?.data?.detail || err.message || "Download failed",
        };
      }

      if (err instanceof Error) {
        if (Object.values(DownloadError).includes(err.message as DownloadError)) {
          return { ok: false, error: err.message };
        }
        if (err.message.includes("Python is not installed") || err.message.includes("Python executable not found")) {
          return {
            ok: false,
            error: "Python is not installed or not found in PATH. Please install Python 3 and ensure it's accessible from the command line.",
          };
        }
        if (err.message.includes("binary not found") || err.message.includes("not found in the application bundle")) {
          return {
            ok: false,
            error: "Python RPC binary not found. The application may be corrupted. Please reinstall the application.",
          };
        }
        if (err.message.includes("failed to start") || err.message.includes("failed to become ready")) {
          return {
            ok: false,
            error: "Python RPC service failed to start. Please restart the application or check the logs for more information.",
          };
        }
        return { ok: false, error: err.message };
      }

      return { ok: false, error: "Unknown error occurred" };
    }
};

registerEvent("startGameDownload", startGameDownload);
