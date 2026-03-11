import axios from "axios";
import http from "node:http";

import cp from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

import { pythonRpcLogger } from "./logger";
import { Readable } from "node:stream";
import { app, BrowserWindow, dialog } from "electron";
import { db, levelKeys } from "@main/level";

interface GamePayload {
  action: string;
  game_id: string;
  url: string | string[];
  save_path: string;
  header?: string;
  out?: string;
  total_size?: number;
  file_indices?: number[];
}

const binaryNameByPlatform: Partial<Record<NodeJS.Platform, string>> = {
  darwin: "hydra-python-rpc",
  linux: "hydra-python-rpc",
  win32: "hydra-python-rpc.exe",
};

export class PythonRPC {
  public static readonly BITTORRENT_PORT = "5881";
  public static readonly DEFAULT_RPC_PORT = "8087";
  public static readonly rpc = axios.create({
    baseURL: `http://localhost:${this.DEFAULT_RPC_PORT}`,
    timeout: 10000,
    httpAgent: new http.Agent({
      family: 4, // Force IPv4
    }),
  });

  private static pythonProcess: cp.ChildProcess | null = null;

  private static describeError(error: unknown): string {
    if (error instanceof Error) {
      return `${error.name}: ${error.message}`;
    }

    return String(error);
  }

  private static logStderr(readable: Readable | null) {
    if (!readable) return;

    readable.setEncoding("utf-8");
    readable.on("data", (chunk: string) => {
      for (const line of chunk.split(/\r?\n/)) {
        const message = line.trim();
        if (!message) continue;

        pythonRpcLogger.log(message);

        for (const window of BrowserWindow.getAllWindows()) {
          if (!window.isDestroyed()) {
            window.webContents.send("on-python-rpc-log", message);
          }
        }
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

  public static async ensureReady(
    retries = 20,
    delayMs = 250,
    timeoutMs = 2000
  ): Promise<void> {
    let lastError: unknown = null;

    for (let attempt = 0; attempt < retries; attempt++) {
      try {
        await this.rpc.get("/healthcheck", { timeout: timeoutMs });
        if (attempt > 0) {
          pythonRpcLogger.log(
            `[PythonRPC] Healthcheck succeeded on attempt ${attempt + 1}/${retries}`
          );
        }
        return;
      } catch (error) {
        lastError = error;
        pythonRpcLogger.warn(
          `[PythonRPC] Healthcheck attempt ${attempt + 1}/${retries} failed: ${this.describeError(error)}`
        );
        if (attempt < retries - 1) {
          await new Promise((resolve) => setTimeout(resolve, delayMs));
        }
      }
    }

    throw lastError instanceof Error
      ? lastError
      : new Error("Python RPC healthcheck failed");
  }

  public static async spawn(
    initialDownload?: GamePayload,
    initialSeeding?: GamePayload[]
  ) {
    pythonRpcLogger.log(
      `[PythonRPC] Starting RPC process (initialDownload=${Boolean(initialDownload)}, initialSeeding=${initialSeeding?.length ?? 0})`
    );

    const rpcPassword = await this.getRPCPassword();

    const commonArgs = [
      this.BITTORRENT_PORT,
      this.DEFAULT_RPC_PORT,
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

      pythonRpcLogger.log(`[PythonRPC] Spawned packaged binary: ${binaryPath}`);

      childProcess.once("spawn", () => {
        pythonRpcLogger.log(
          `[PythonRPC] Process spawned (pid=${childProcess.pid ?? "unknown"})`
        );
      });
      childProcess.on("error", (error) => {
        pythonRpcLogger.error("[PythonRPC] Process error:", error);
      });
      childProcess.on("exit", (code, signal) => {
        pythonRpcLogger.warn(
          `[PythonRPC] Process exited (code=${code ?? "null"}, signal=${signal ?? "null"})`
        );

        if (this.pythonProcess === childProcess) {
          this.pythonProcess = null;
        }
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

      pythonRpcLogger.log(
        `[PythonRPC] Spawned development script: ${scriptPath}`
      );

      childProcess.once("spawn", () => {
        pythonRpcLogger.log(
          `[PythonRPC] Process spawned (pid=${childProcess.pid ?? "unknown"})`
        );
      });
      childProcess.on("error", (error) => {
        pythonRpcLogger.error("[PythonRPC] Process error:", error);
      });
      childProcess.on("exit", (code, signal) => {
        pythonRpcLogger.warn(
          `[PythonRPC] Process exited (code=${code ?? "null"}, signal=${signal ?? "null"})`
        );

        if (this.pythonProcess === childProcess) {
          this.pythonProcess = null;
        }
      });

      this.logStderr(childProcess.stderr);

      this.pythonProcess = childProcess;
    }

    this.rpc.defaults.headers.common["x-hydra-rpc-password"] = rpcPassword;
    pythonRpcLogger.log("[PythonRPC] Waiting for healthcheck readiness...");

    try {
      await this.ensureReady();
      pythonRpcLogger.log("[PythonRPC] RPC healthcheck is ready");
    } catch (error) {
      pythonRpcLogger.error("[PythonRPC] RPC failed readiness checks:", error);
      throw error;
    }
  }

  public static kill() {
    if (this.pythonProcess) {
      pythonRpcLogger.log(
        `[PythonRPC] Killing python process (pid=${this.pythonProcess.pid ?? "unknown"})`
      );
      this.pythonProcess.kill();
      this.pythonProcess = null;
    }
  }
}
