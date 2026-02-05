import axios from "axios";
import http from "node:http";

import cp from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import net from "node:net";
import path from "node:path";

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
const DEFAULT_RPC_PORT = 8084;

export class PythonRPC {
  public static readonly BITTORRENT_PORT = "5881";
  public static readonly rpc = axios.create({
    baseURL: `http://localhost:${DEFAULT_RPC_PORT}`,
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

  private static async isPortAvailable(port: number) {
    return new Promise<boolean>((resolve) => {
      const server = net.createServer();
      server.unref();

      server.on("error", () => {
        server.close(() => resolve(false));
      });

      server.listen(port, "127.0.0.1", () => {
        server.close(() => resolve(true));
      });
    });
  }

  private static async findAvailablePort() {
    const scannedPorts = new Set<number>();
    const enqueuePort = (port: number) => {
      if (port < RPC_PORT_RANGE_START || port > RPC_PORT_RANGE_END) return;
      if (!scannedPorts.has(port)) scannedPorts.add(port);
    };

    enqueuePort(DEFAULT_RPC_PORT);
    for (let port = RPC_PORT_RANGE_START; port <= RPC_PORT_RANGE_END; port++) {
      enqueuePort(port);
    }

    for (const port of scannedPorts) {
      if (await this.isPortAvailable(port)) {
        return port;
      }
    }

    throw new Error("No available RPC port found");
  }

  private static updateRpcPort(port: number) {
    this.rpc.defaults.baseURL = `http://localhost:${port}`;
  }

  public static async spawn(
    initialDownload?: GamePayload,
    initialSeeding?: GamePayload[]
  ) {
    const rpcPassword = await this.getRPCPassword();

    let port: number;
    try {
      port = await this.findAvailablePort();
    } catch (err) {
      const message =
        err instanceof Error && err.message
          ? err.message
          : "Unknown error while selecting RPC port";
      dialog.showErrorBox(
        "RPC Error",
        `Failed to select an available port for the download service.\n\n${message}`
      );
      throw err;
    }

    this.updateRpcPort(port);
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
