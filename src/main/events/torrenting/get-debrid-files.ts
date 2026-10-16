import { registerEvent } from "../register-event";
import { RealDebridClient } from "@main/services/download/real-debrid";
import { TorBoxClient } from "@main/services/download/torbox";
import { logger } from "@main/services";
import { DownloadError, Downloader } from "@shared";
import type { TorrentFilesResponse } from "@types";

const getDebridFiles = async (
  _event: Electron.IpcMainInvokeEvent,
  magnet: string,
  provider: Downloader
): Promise<
  { ok: true; data: TorrentFilesResponse } | { ok: false; error: string }
> => {
  if (typeof magnet !== "string" || !magnet.startsWith("magnet:")) {
    return { ok: false, error: DownloadError.InvalidMagnet };
  }

  try {
    let data: TorrentFilesResponse;
    switch (provider) {
      case Downloader.TorBox: {
        const manifest = await TorBoxClient.getDownloadFiles(magnet, true);
        data = {
          infoHash: "",
          name: manifest.name,
          totalSize: manifest.totalSize,
          archiveOnly: manifest.archiveOnly,
          files: manifest.files.map((file) => ({
            index: file.id,
            path: file.path,
            length: file.size,
          })),
        };
        break;
      }
      case Downloader.RealDebrid:
        data = await RealDebridClient.getDownloadFiles(magnet);
        break;
      default:
        return { ok: false, error: DownloadError.TorrentFilesUnavailable };
    }
    return { ok: true, data };
  } catch (error) {
    if (provider === Downloader.TorBox) {
      logger.error(
        `Failed to get TorBox files: ${error instanceof Error ? error.message : "unknown error"}`
      );
    } else {
      logger.error("Failed to get debrid files", error);
    }
    return {
      ok: false,
      error:
        error instanceof Error
          ? error.message
          : DownloadError.TorrentFilesUnavailable,
    };
  }
};

registerEvent("getDebridFiles", getDebridFiles);
