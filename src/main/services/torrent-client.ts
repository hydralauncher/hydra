import path from "node:path";
import cp from "node:child_process";
import fs from "node:fs";
import { app, dialog } from "electron";
import { readPipe, writePipe } from "./fifo";

const binaryNameByPlatform: Partial<Record<NodeJS.Platform, string>> = {
  darwin: "hydra-download-manager",
  linux: "hydra-download-manager",
  win32: "hydra-download-manager.exe",
};

export const BITTORRENT_PORT = "5881";

const commonArgs = [BITTORRENT_PORT, writePipe.socketPath, readPipe.socketPath];

export const startTorrentClient = async (): Promise<cp.ChildProcess> => {
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

    const torrentClient = cp.spawn(binaryPath, commonArgs, {
      stdio: "inherit",
      windowsHide: true,
    });

    await Promise.all([writePipe.createPipe(), readPipe.createPipe()]);

    return torrentClient;
  } else {
    const scriptPath = path.join(
      __dirname,
      "..",
      "..",
      "torrent-client",
      "main.py"
    );

    const torrentClient = cp.spawn("python3", [scriptPath, ...commonArgs], {
      stdio: "inherit",
    });

    await Promise.all([writePipe.createPipe(), readPipe.createPipe()]);

    return torrentClient;
  }
};
