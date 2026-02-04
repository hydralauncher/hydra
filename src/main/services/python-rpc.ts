import axios, { AxiosInstance } from "axios";
import http from "node:http";
import getPort, { portNumbers } from "get-port";

import cp from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";

import { pythonRpcLogger } from "./logger";
import { Readable } from "node:stream";
import { app, dialog } from "electron";
import { db, levelKeys } from "@main/level";

interface GamePayload {
  action: string;
  game_id: string;
  url: string | string[];
  save_path: string;
  header?: string;
  out?: string;
  total_size?: number;
}

const binaryNameByPlatform: Partial<Record<NodeJS.Platform, string>> = {
  darwin: "hydra-python-rpc",
  linux: "hydra-python-rpc",
  win32: "hydra-python-rpc.exe",
};

const RPC_PORT_RANGE_START = 8080;
const RPC_PORT_RANGE_END = 9000;
const PREFERRED_RPC_PORT = 8084;
const HEALTH_CHECK_INTERVAL_MS = 100;
const HEALTH_CHECK_TIMEOUT_MS = 10000;

export class PythonRPC {
  public static readonly BITTORRENT_PORT = "5881";

  private static _rpc: AxiosInstance | null = null;

  public static get rpc(): AxiosInstance {
    if (!this._rpc) {
      throw new Error("PythonRPC not initialized. Call spawn() first.");
    }
    return this._rpc;
  }

  private static pythonProcess: cp.ChildProcess | null = null;

  private static logStderr(readable: Readable | null) {
    if (!readable) return;

    readable.setEncoding("utf-8");
    readable.on("data", pythonRpcLogger.log);
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

  private static async waitForHealthCheck(): Promise<void> {
    const startTime = Date.now();

    while (Date.now() - startTime < HEALTH_CHECK_TIMEOUT_MS) {
      try {
        const response = await this.rpc.get("/healthcheck", { timeout: 1000 });
        if (response.status === 200) {
          pythonRpcLogger.log("RPC health check passed");
          return;
        }
      } catch {
        // Server not ready yet, continue polling
      }
      await new Promise((resolve) =>
        setTimeout(resolve, HEALTH_CHECK_INTERVAL_MS)
      );
    }

    throw new Error("RPC health check timed out");
  }

  public static async spawn(
    initialDownload?: GamePayload,
    initialSeeding?: GamePayload[]
  ) {
    const rpcPassword = await this.getRPCPassword();

    const port = await getPort({
      port: [
        PREFERRED_RPC_PORT,
        ...portNumbers(RPC_PORT_RANGE_START, RPC_PORT_RANGE_END),
      ],
    });

    this._rpc = axios.create({
      baseURL: `http://localhost:${port}`,
      httpAgent: new http.Agent({
        family: 4, // Force IPv4
      }),
    });

    pythonRpcLogger.log(`Using RPC port: ${port}`);

    const commonArgs = [
      this.BITTORRENT_PORT,
      String(port),
      rpcPassword,
      initialDownload ? JSON.stringify(initialDownload) : "",
      initialSeeding ? JSON.stringify(initialSeeding) : "",
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
        return;
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

      const childProcess = cp.spawn("python", [scriptPath, ...commonArgs], {
        stdio: ["inherit", "inherit"],
      });

      this.logStderr(childProcess.stderr);
      this.pythonProcess = childProcess;
    }

    this._rpc.defaults.headers.common["x-hydra-rpc-password"] = rpcPassword;

    try {
      await this.waitForHealthCheck();
      pythonRpcLogger.log(`Python RPC started successfully on port ${port}`);
    } catch (err) {
      pythonRpcLogger.log(`Failed to start Python RPC: ${err}`);
      dialog.showErrorBox(
        "RPC Error",
        `Failed to start download service.\n\nThe service did not respond in time. Please try restarting Hydra.`
      );
      this.kill();
      throw err;
    }
  }

  public static kill() {
    if (this.pythonProcess) {
      pythonRpcLogger.log("Killing python process");
      this.pythonProcess.kill();
      this.pythonProcess = null;
    }
  }
}
