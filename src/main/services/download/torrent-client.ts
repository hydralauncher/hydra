import path from "node:path";
import cp from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import { app, dialog } from "electron";
import type { StartDownloadPayload } from "./types";

const binaryNameByPlatform: Partial<Record<NodeJS.Platform, string>> = {
  darwin: "hydra-download-manager",
  linux: "hydra-download-manager",
  win32: "hydra-download-manager.exe",
};

export const BITTORRENT_PORT = "5881";
export const RPC_PORT = "8084";
export const RPC_PASSWORD = crypto.randomBytes(32).toString("hex");

export const startTorrentClient = (args?: StartDownloadPayload) => {
  const commonArgs = [
    BITTORRENT_PORT,
    RPC_PORT,
    RPC_PASSWORD,
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

    return cp.spawn(binaryPath, commonArgs, {
      stdio: "inherit",
      windowsHide: true,
    });
  } else {
    const scriptPath = path.join(
      __dirname,
      "..",
      "..",
      "torrent-client",
      "main.py"
    );

    return cp.spawn("python3", [scriptPath, ...commonArgs], {
      stdio: "inherit",
    });
  }
};
