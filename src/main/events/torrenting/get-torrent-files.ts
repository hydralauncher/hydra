import { registerEvent } from "../register-event";
import { PythonRPC } from "@main/services/python-rpc";
import type { TorrentFilesResponse } from "@types";
import { DownloadError } from "@shared";

const mapTorrentFilesError = (error: unknown) => {
  const rpcError =
    typeof error === "object" && error !== null && "response" in error
      ? ((error as { response?: { data?: { error?: string } } }).response?.data
          ?.error ?? undefined)
      : undefined;

  if (rpcError) {
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
    return DownloadError.TorrentFilesUnavailable;
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
    const response = await PythonRPC.rpc.call<TorrentFilesResponse>(
      "torrent_files",
      {
        magnet,
        timeout_ms: 45_000,
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
