import axios from "axios";
import http from "node:http";

import cp from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";

import { pythonRpcLogger } from "./logger";
import { Readable } from "node:stream";
import { app, dialog } from "electron";
import { db, levelKeys } from "@main/level";
import { GamePayload } from "@types";

const binaryNameByPlatform: Partial<Record<NodeJS.Platform, string>> = {
  darwin: "hydra-python-rpc",
  linux: "hydra-python-rpc",
  win32: "hydra-python-rpc.exe",
};

export class PythonRPC {
  public static readonly BITTORRENT_PORT = "5881";
  public static readonly RPC_PORT = "8084";
  public static readonly rpc = axios.create({
    baseURL: `http://localhost:${this.RPC_PORT}`,
    httpAgent: new http.Agent({
      family: 4, // Force IPv4
    }),
  });

  private static pythonProcess: cp.ChildProcess | null = null;
  private static restartCount = 0;
  private static readonly MAX_RESTARTS = 5;

  private static logStream(
    readable: Readable | null,
    type: "stdout" | "stderr"
  ) {
    if (!readable) return;

    readable.setEncoding("utf-8");
    readable.on("data", (data) => {
      const message = data.trim();
      if (!message) return;

      if (type === "stderr") {
        pythonRpcLogger.error(message);
      } else {
        pythonRpcLogger.info(message);
      }
    });
  }

  private static async getRPCPassword() {
    const existingPassword = await db.get(levelKeys.rpcPassword, {
      valueEncoding: "utf8",
    });

    if (existingPassword) return existingPassword;

    const newPassword = crypto.randomBytes(32).toString("hex");

    await db.put(levelKeys.rpcPassword, newPassword, {
      valueEncoding: "utf8",
    });

    return newPassword;
  }

  public static async spawn(
    initialDownload?: GamePayload,
    initialSeeding?: GamePayload[]
  ) {
    const rpcPassword = await this.getRPCPassword();

    const commonArgs = [
      this.BITTORRENT_PORT,
      this.RPC_PORT,
      rpcPassword,
      initialDownload ? JSON.stringify(initialDownload) : "",
      initialSeeding ? JSON.stringify(initialSeeding) : "",
    ];

    let childProcess: cp.ChildProcess;

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
        return;
      }

      childProcess = cp.spawn(binaryPath, commonArgs, {
        windowsHide: true,
        stdio: ["pipe", "pipe", "pipe"],
      });
    } else {
      const scriptPath = path.join(
        __dirname,
        "..",
        "..",
        "python_rpc",
        "main.py"
      );

      childProcess = cp.spawn("python", [scriptPath, ...commonArgs], {
        stdio: ["pipe", "pipe", "pipe"],
      });
    }

    this.logStream(childProcess.stdout, "stdout");
    this.logStream(childProcess.stderr, "stderr");

    childProcess.on("exit", (code) => {
      pythonRpcLogger.warn(`Python process exited with code ${code}`);
      this.pythonProcess = null;

      if (this.restartCount < this.MAX_RESTARTS) {
        this.restartCount++;
        pythonRpcLogger.info(
          `Attempting to restart Python RPC (${this.restartCount}/${this.MAX_RESTARTS})...`
        );
        setTimeout(() => this.spawn(initialDownload, initialSeeding), 2000);
      } else {
        pythonRpcLogger.error(
          "Maximum Python RPC restart attempts reached. Please restart the application."
        );
      }
    });

    this.pythonProcess = childProcess;
    this.rpc.defaults.headers.common["x-hydra-rpc-password"] = rpcPassword;
  }

  public static kill() {
    if (this.pythonProcess) {
      pythonRpcLogger.log("Killing python process");
      this.pythonProcess.kill();
      this.pythonProcess = null;
    }
  }
}
