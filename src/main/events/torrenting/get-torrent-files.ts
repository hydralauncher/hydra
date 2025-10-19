import { registerEvent } from "../register-event";
import { PythonRPC } from "@main/services/python-rpc";
import { logger } from "@main/services";
import type { TorrentFile } from "@types";
import { AxiosError } from "axios";

const getTorrentFiles = async (
  _event: Electron.IpcMainInvokeEvent,
  magnetUri: string
): Promise<TorrentFile[]> => {
  if (!magnetUri || !magnetUri.startsWith("magnet")) {
    throw new Error("Invalid magnet URI");
  }

  // Ensure Python RPC server is running
  if (!PythonRPC.isRunning()) {
    logger.log("Python RPC server not running, starting it now...");
    await PythonRPC.spawn();
    // Give the server a brief moment to start
    await new Promise((resolve) => setTimeout(resolve, 500));
  }

  try {
    const response = await PythonRPC.rpc.post<TorrentFile[]>("/torrent-files", {
      magnet_uri: magnetUri,
    });

    return response.data;
  } catch (error) {
    logger.error("Failed to fetch torrent files", error);

    if (error instanceof AxiosError) {
      const errorMessage = error.response?.data?.error || error.message;
      throw new Error(errorMessage);
    }

    if (error instanceof Error) {
      throw new Error(error.message);
    }

    throw new Error("Failed to fetch torrent files");
  }
};

registerEvent("getTorrentFiles", getTorrentFiles);
