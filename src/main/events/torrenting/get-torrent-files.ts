import { registerEvent } from "../register-event";
import { PythonRPC } from "@main/services/python-rpc";
import { logger } from "@main/services";
import type { TorrentFile } from "@types";
import axios, { AxiosError } from "axios";

const PING_ATTEMPTS = 5;
const PING_BACKOFF_MS = 200;

function isValidMagnet(uri?: string) {
  return typeof uri === "string" && uri.startsWith("magnet:");
}

async function pingRpcOnce(): Promise<boolean> {
  try {
    const client = (PythonRPC.rpc as typeof axios) || axios;
    await client.get("/ping", { timeout: 1000 });
    return true;
  } catch (err) {
    return false;
  }
}

async function ensurePythonRpcRunning(): Promise<void> {
  const firstOk = await pingRpcOnce();
  if (firstOk) return;

  if (PythonRPC.isRunning()) {
    logger.warn(
      "Python RPC reported running but did not respond to ping; attempting restart"
    );
  } else {
    logger.log("Python RPC server not running, starting it now...");
  }
  await PythonRPC.spawn();

  for (let attempt = 1; attempt <= PING_ATTEMPTS; attempt += 1) {
    if (await pingRpcOnce()) return;

    logger.log(`Python RPC ping attempt ${attempt} failed`);
    await new Promise((r) => setTimeout(r, PING_BACKOFF_MS * attempt));
  }

  throw new Error("Python RPC did not respond to ping after starting");
}

const getTorrentFiles = async (
  _event: Electron.IpcMainInvokeEvent,
  magnetUri: string
): Promise<TorrentFile[]> => {
  if (!isValidMagnet(magnetUri)) {
    throw new Error("Invalid magnet URI");
  }

  await ensurePythonRpcRunning();

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
