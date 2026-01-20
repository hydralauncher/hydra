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

const RPC_PORT_PREFIX = "RPC_PORT:";
const PORT_DISCOVERY_TIMEOUT_MS = 30000;
const HEALTH_CHECK_INTERVAL_MS = 100;
const HEALTH_CHECK_TIMEOUT_MS = 10000;

export class PythonRPC {
  public static readonly BITTORRENT_PORT = "5881";
  public static readonly DEFAULT_RPC_PORT = "8084";

  private static currentPort: string = this.DEFAULT_RPC_PORT;

  public static readonly rpc = axios.create({
    baseURL: `http://localhost:${this.DEFAULT_RPC_PORT}`,
    httpAgent: new http.Agent({
      family: 4, // Force IPv4
    }),
  });

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

  private static updateBaseURL(port: string) {
    this.currentPort = port;
    this.rpc.defaults.baseURL = `http://localhost:${port}`;
    pythonRpcLogger.log(`RPC baseURL updated to port ${port}`);
  }

  private static parsePortFromStdout(data: string): string | null {
    const lines = data.split("\n");
    for (const line of lines) {
      if (line.startsWith(RPC_PORT_PREFIX)) {
        return line.slice(RPC_PORT_PREFIX.length).trim();
      }
    }
    return null;
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

  private static waitForPort(
    childProcess: cp.ChildProcess
  ): Promise<string | null> {
    return new Promise((resolve, reject) => {
      let resolved = false;
      let stdoutBuffer = "";

      const timeout = setTimeout(() => {
        if (!resolved) {
          resolved = true;
          reject(
            new Error(
              `Port discovery timed out after ${PORT_DISCOVERY_TIMEOUT_MS}ms`
            )
          );
        }
      }, PORT_DISCOVERY_TIMEOUT_MS);

      const cleanup = () => {
        clearTimeout(timeout);
      };

      if (childProcess.stdout) {
        childProcess.stdout.setEncoding("utf-8");
        childProcess.stdout.on("data", (data: string) => {
          stdoutBuffer += data;
          pythonRpcLogger.log(data);

          const port = this.parsePortFromStdout(stdoutBuffer);
          if (port && !resolved) {
            resolved = true;
            cleanup();
            resolve(port);
          }
        });
      }

      childProcess.on("error", (err) => {
        if (!resolved) {
          resolved = true;
          cleanup();
          reject(err);
        }
      });

      childProcess.on("exit", (code) => {
        if (!resolved) {
          resolved = true;
          cleanup();
          if (code === 0) {
            resolve(null);
          } else {
            reject(new Error(`Python RPC process exited with code ${code}`));
          }
        }
      });
    });
  }

  public static async spawn(
    initialDownload?: GamePayload,
    initialSeeding?: GamePayload[]
  ) {
    const rpcPassword = await this.getRPCPassword();

    const commonArgs = [
      this.BITTORRENT_PORT,
      this.DEFAULT_RPC_PORT,
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
        stdio: ["inherit", "pipe", "pipe"],
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
        stdio: ["inherit", "pipe", "pipe"],
      });
    }

    this.logStderr(childProcess.stderr);
    this.pythonProcess = childProcess;

    try {
      const port = await this.waitForPort(childProcess);

      if (port) {
        this.updateBaseURL(port);
      } else {
        pythonRpcLogger.log(
          `No port received, using default port ${this.DEFAULT_RPC_PORT}`
        );
        this.updateBaseURL(this.DEFAULT_RPC_PORT);
      }

      this.rpc.defaults.headers.common["x-hydra-rpc-password"] = rpcPassword;

      await this.waitForHealthCheck();

      pythonRpcLogger.log(
        `Python RPC started successfully on port ${this.currentPort}`
      );
    } catch (err) {
      pythonRpcLogger.log(`Failed to start Python RPC: ${err}`);

      dialog.showErrorBox(
        "RPC Error",
        `Failed to start download service. ${err instanceof Error ? err.message : String(err)}\n\nPlease ensure no other application is using ports 8080-9000 and try restarting Hydra.`
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
