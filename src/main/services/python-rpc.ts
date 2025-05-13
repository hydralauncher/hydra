import axios from "axios";

import cp from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";

import { pythonRpcLogger } from "./logger";
import { Readable } from "node:stream";
import { app, dialog } from "electron";
import { db, levelKeys } from "@main/level";

interface GamePayload {
  game_id: string;
  url: string;
  save_path: string;
}

const binaryNameByPlatform: Partial<Record<NodeJS.Platform, string>> = {
  darwin: "hydra-python-rpc",
  linux: "hydra-python-rpc",
  win32: "hydra-python-rpc.exe",
};

const rustBinaryNameByPlatform: Partial<Record<NodeJS.Platform, string>> = {
  darwin: "hydra-httpdl",
  linux: "hydra-httpdl",
  win32: "hydra-httpdl.exe",
};

export class PythonRPC {
  public static readonly BITTORRENT_PORT = "5881";
  public static readonly RPC_PORT = "8084";
  public static readonly rpc = axios.create({
    baseURL: `http://localhost:${this.RPC_PORT}`,
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
      app.isPackaged
        ? path.join(
            process.resourcesPath,
            rustBinaryNameByPlatform[process.platform]!
          )
        : path.join(
            __dirname,
            "..",
            "..",
            "rust_rpc",
            "target",
            "debug",
            rustBinaryNameByPlatform[process.platform]!
          ),
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
