import { registerEvent } from "../register-event";
import { NativeAddon } from "@main/services/native-addon";
import type { TorrentFilesResponse } from "@types";
import { DownloadError } from "@shared";

const mapTorrentFilesError = (error: unknown) => {
  if (error instanceof Error) {
    switch (error.message) {
      case "invalid_magnet":
        return DownloadError.InvalidMagnet;
      case "metadata_timeout":
        return DownloadError.TorrentMetadataTimeout;
      case "metadata_incomplete":
        return DownloadError.TorrentMetadataIncomplete;
      case "too_many_files":
        return DownloadError.TorrentTooManyFiles;
      default:
        return DownloadError.TorrentFilesUnavailable;
    }
  }

  return DownloadError.TorrentFilesUnavailable;
};

const getTorrentFiles = async (
  _event: Electron.IpcMainInvokeEvent,
  magnet: string
) => {
  if (!magnet || typeof magnet !== "string" || !magnet.startsWith("magnet:")) {
    return { ok: false, error: DownloadError.InvalidMagnet };
  }

  try {
    const response = NativeAddon.getTorrentFiles(magnet, 45_000);

    return {
      ok: true,
      data: response as TorrentFilesResponse,
    };
  } catch (error) {
    return {
      ok: false,
      error: mapTorrentFilesError(error),
    };
  }
};

registerEvent("getTorrentFiles", getTorrentFiles);
