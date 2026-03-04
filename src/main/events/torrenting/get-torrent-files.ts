import { registerEvent } from "../register-event";
import { PythonRPC } from "@main/services/python-rpc";
import type { TorrentFilesResponse } from "@types";
import { AxiosError } from "axios";
import { DownloadError } from "@shared";

const mapTorrentFilesError = (error: unknown) => {
  if (error instanceof AxiosError) {
    const rpcError = (error.response?.data as { error?: string } | undefined)
      ?.error;

    switch (rpcError) {
      case "invalid_magnet":
        return DownloadError.InvalidMagnet;
      case "metadata_timeout":
        return DownloadError.TorrentMetadataTimeout;
      case "metadata_incomplete":
        return DownloadError.TorrentMetadataIncomplete;
      case "too_many_files":
        return DownloadError.TorrentTooManyFiles;
      case "metadata_busy":
        return DownloadError.TorrentMetadataTimeout;
      default:
        return DownloadError.TorrentFilesUnavailable;
    }
  }

  if (error instanceof Error) {
    return error.message;
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
    await PythonRPC.ensureReady();

    const response = await PythonRPC.rpc.post<TorrentFilesResponse>(
      "/torrent-files",
      {
        magnet,
      },
      {
        timeout: 45000,
      }
    );

    return {
      ok: true,
      data: response.data,
    };
  } catch (error) {
    return {
      ok: false,
      error: mapTorrentFilesError(error),
    };
  }
};

registerEvent("getTorrentFiles", getTorrentFiles);
