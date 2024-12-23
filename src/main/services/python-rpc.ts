import axios from "axios";

import cp from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";

import { logger } from "./logger";
import { Readable } from "node:stream";
import { app, dialog } from "electron";

interface StartDownloadPayload {
  game_id: number;
  url: string;
  save_path: string;
}

const binaryNameByPlatform: Partial<Record<NodeJS.Platform, string>> = {
  darwin: "hydra-python-rpc",
  linux: "hydra-python-rpc",
  win32: "hydra-python-rpc.exe",
};

export class PythonRPC {
  public static readonly BITTORRENT_PORT = "5881";
  public static readonly RPC_PORT = "8084";
  private static readonly RPC_PASSWORD = crypto.randomBytes(32).toString("hex");

  private static pythonProcess: cp.ChildProcess | null = null;

  public static rpc = axios.create({
    baseURL: `http://localhost:${this.RPC_PORT}`,
    headers: {
      "x-hydra-rpc-password": this.RPC_PASSWORD,
    },
  });

  private static logStderr(readable: Readable | null) {
    if (!readable) return;

    readable.setEncoding("utf-8");
    readable.on("data", logger.log);
  }

  public static spawn(initialDownload?: StartDownloadPayload) {
    const commonArgs = [
      this.BITTORRENT_PORT,
      this.RPC_PORT,
      this.RPC_PASSWORD,
      initialDownload ? JSON.stringify(initialDownload) : "",
    ];

    if (app.isPackaged) {
      const binaryName = binaryNameByPlatform[process.platform]!;
      const binaryPath = path.join(
        process.resourcesPath,
        "hydra-python-rpc",
        binaryName
      );

      if (!fs.existsSync(binaryPath)) {
        dialog.showErrorBox(
          "Fatal",
          "Hydra Python Instance binary not found. Please check if it has been removed by Windows Defender."
        );

        app.quit();
      }

      const childProcess = cp.spawn(binaryPath, commonArgs, {
        windowsHide: true,
        stdio: ["inherit", "inherit"],
      });

      this.logStderr(childProcess.stderr);

      this.pythonProcess = childProcess;
    } else {
      const scriptPath = path.join(
        __dirname,
        "..",
        "..",
        "python_rpc",
        "main.py"
      );

      const childProcess = cp.spawn("python3", [scriptPath, ...commonArgs], {
        stdio: ["inherit", "inherit"],
      });

      this.logStderr(childProcess.stderr);

      this.pythonProcess = childProcess;
    }
  }

  public static kill() {
    if (this.pythonProcess) {
      logger.log("Killing python process");
      this.pythonProcess.kill();
      this.pythonProcess = null;
    }
  }
}
