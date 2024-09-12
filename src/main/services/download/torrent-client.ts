import path from "node:path";
import cp from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import { app, dialog } from "electron";
import type { StartDownloadPayload } from "./types";
import { Readable } from "node:stream";
import { pythonInstanceLogger as logger } from "../logger";
import { useAppSelector } from "@renderer/src/hooks";


const userClientPreferences = useAppSelector(
  (state) => state.userClientPreferences.value
);

const binaryNameByPlatform: Partial<Record<NodeJS.Platform, string>> = {
  darwin: "hydra-download-manager",
  linux: "hydra-download-manager",
  win32: "hydra-download-manager.exe",
};

export const BITTORRENT_PORT = "5881";
export const RPC_PORT = "8084";
export const RPC_PASSWORD = crypto.randomBytes(32).toString("hex");

const logStderr = (readable: Readable | null) => {
  if (!readable) return;

  readable.setEncoding("utf-8");
  readable.on("data", logger.log);
};

export const startTorrentClient = (args?: StartDownloadPayload) => {
  const commonArgs = [
    BITTORRENT_PORT,
    RPC_PORT,
    RPC_PASSWORD,
    userClientPreferences,
    args ? encodeURIComponent(JSON.stringify(args)) : "",
  ];

  if (app.isPackaged) {
    const binaryName = binaryNameByPlatform[process.platform]!;
    const binaryPath = path.join(
      process.resourcesPath,
      "hydra-download-manager",
      binaryName
    );

    if (!fs.existsSync(binaryPath)) {
      dialog.showErrorBox(
        "Fatal",
        "Hydra Download Manager binary not found. Please check if it has been removed by Windows Defender."
      );

      app.quit();
    }

    const childProcess = cp.spawn(binaryPath, commonArgs, {
      windowsHide: true,
      stdio: ["inherit", "inherit"],
    });

    logStderr(childProcess.stderr);

    return childProcess;
  } else {
    const scriptPath = path.join(
      __dirname,
      "..",
      "..",
      "torrent-client",
      "main.py"
    );

    const childProcess = cp.spawn("python3", [scriptPath, ...commonArgs], {
      stdio: ["inherit", "inherit"],
    });

    logStderr(childProcess.stderr);

    return childProcess;
  }
};
