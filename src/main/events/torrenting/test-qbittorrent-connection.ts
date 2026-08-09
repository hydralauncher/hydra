import type { QbittorrentServer } from "@types";
import { QbittorrentClient } from "@main/services/download/qbittorrent";
import { registerEvent } from "../register-event";

const testQbittorrentConnection = async (
  _event: Electron.IpcMainInvokeEvent,
  server: QbittorrentServer
) => {
  try {
    const version = await new QbittorrentClient(server).getVersion();
    return { ok: true as const, version };
  } catch (error) {
    return {
      ok: false as const,
      error: error instanceof Error ? error.message : "Connection failed",
    };
  }
};

registerEvent("testQbittorrentConnection", testQbittorrentConnection);
