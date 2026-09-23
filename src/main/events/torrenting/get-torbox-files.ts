import { registerEvent } from "../register-event";
import { TorBoxClient } from "@main/services/download/torbox";
import { DownloadError } from "@shared";
import { logger } from "@main/services";
import type { TorrentFilesResponse } from "@types";

const getTorBoxFiles = async (
  _event: Electron.IpcMainInvokeEvent,
  magnet: string
): Promise<
  { ok: true; data: TorrentFilesResponse } | { ok: false; error: string }
> => {
  if (typeof magnet !== "string" || !magnet.startsWith("magnet:")) {
    return { ok: false, error: DownloadError.InvalidMagnet };
  }

  try {
    const manifest = await TorBoxClient.getDownloadFiles(magnet);
    return {
      ok: true,
      data: {
        infoHash: "",
        name: manifest.name,
        totalSize: manifest.totalSize,
        files: manifest.files.map((file) => ({
          index: file.id,
          path: file.path,
          length: file.size,
        })),
      },
    };
  } catch (error) {
    logger.error(
      `Failed to get TorBox files: ${error instanceof Error ? error.message : "unknown error"}`
    );
    return {
      ok: false,
      error:
        error instanceof Error
          ? error.message
          : DownloadError.TorrentFilesUnavailable,
    };
  }
};

registerEvent("getTorBoxFiles", getTorBoxFiles);
