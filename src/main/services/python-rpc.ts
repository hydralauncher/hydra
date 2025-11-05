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

  private static async findPythonExecutable(): Promise<string> {
    // On macOS, try common Python locations first (especially for packaged apps)
    const commonPaths: string[] = [];
    if (process.platform === "darwin") {
      commonPaths.push(
        "/opt/homebrew/bin/python3",
        "/usr/local/bin/python3",
        "/usr/bin/python3",
        path.join(process.env.HOME || "", ".local", "bin", "python3")
      );
    }

    const candidates =
      process.platform === "win32"
        ? ["python"]
        : [...commonPaths, "python3", "python"];

    for (const pythonCmd of candidates) {
      try {
        await new Promise<void>((resolve, reject) => {
          const proc = cp.spawn(pythonCmd, ["--version"], {
            stdio: "pipe",
          });
          proc.on("close", (code) => {
            if (code === 0) {
              resolve();
            } else {
              reject(
                new Error(`Python version check failed with code ${code}`)
              );
            }
          });
          proc.on("error", reject);
        });
        pythonRpcLogger.log(`Found Python executable: ${pythonCmd}`);
        return pythonCmd;
      } catch (error) {
        pythonRpcLogger.warn(
          `Python candidate ${pythonCmd} not available: ${error}`
        );
        // Try next candidate
      }
    }

    throw new Error(
      `Python executable not found. Please install Python 3 and ensure it's in your PATH. Tried: ${candidates.join(", ")}`
    );
  }

  public static async waitForService(
    maxAttempts = 30,
    delayMs = 500
  ): Promise<boolean> {
    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      try {
        await this.rpc.get("/status");
        return true;
      } catch (error) {
        if (attempt < maxAttempts - 1) {
          await new Promise((resolve) => setTimeout(resolve, delayMs));
        }
      }
    }
    return false;
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

    pythonRpcLogger.log(`=== Python RPC Spawn Debug ===`);
    pythonRpcLogger.log(`app.isPackaged: ${app.isPackaged}`);
    pythonRpcLogger.log(`process.platform: ${process.platform}`);
    pythonRpcLogger.log(`process.resourcesPath: ${process.resourcesPath}`);
    pythonRpcLogger.log(`__dirname: ${__dirname}`);

    if (app.isPackaged) {
      // On macOS, use Python directly since frozen binary has import issues
      // On Windows/Linux, use the frozen binary
      if (process.platform === "darwin") {
        pythonRpcLogger.log(
          `Using macOS packaged build path (Python script mode)`
        );
        // Try multiple possible paths for the Python script
        // electron-builder flattens python_rpc into Resources/, so main.py is at Resources/main.py
        const possiblePaths = [
          path.join(process.resourcesPath, "main.py"), // electron-builder flattens it here
          path.join(process.resourcesPath, "python_rpc", "main.py"), // fallback if not flattened
          path.join(__dirname, "..", "..", "python_rpc", "main.py"),
        ];

        let scriptPath: string | null = null;
        for (const testPath of possiblePaths) {
          if (fs.existsSync(testPath)) {
            scriptPath = testPath;
            pythonRpcLogger.log(`Found Python RPC script at: ${scriptPath}`);
            break;
          }
        }

        if (!scriptPath) {
          pythonRpcLogger.error(
            `Python RPC script not found. Tried: ${possiblePaths.join(", ")}`
          );
          throw new Error(
            "Python RPC script not found in the application bundle."
          );
        }

        const pythonExecutable = await this.findPythonExecutable();
        pythonRpcLogger.log(`Using Python executable: ${pythonExecutable}`);
        pythonRpcLogger.log(`Using Python RPC script: ${scriptPath}`);

        // Set cwd to resourcesPath so Python can find all the other .py files
        // (electron-builder flattens python_rpc into Resources/)
        // Also set PATH to include common Python locations on macOS
        const env = { ...process.env };
        // Add common Python paths to ensure dependencies are found
        const pythonPaths = [
          "/opt/homebrew/bin",
          "/usr/local/bin",
          "/usr/bin",
          path.join(process.env.HOME || "", ".local", "bin"),
        ];
        const currentPath = process.env.PATH || "";
        env.PATH = [...pythonPaths, currentPath].join(":");

        pythonRpcLogger.log(`Spawning Python with PATH: ${env.PATH}`);

        const childProcess = cp.spawn(
          pythonExecutable,
          [scriptPath, ...commonArgs],
          {
            stdio: ["pipe", "pipe", "pipe"],
            cwd: process.resourcesPath,
            env,
          }
        );

        if (childProcess.stdout) {
          childProcess.stdout.on("data", (data) => {
            pythonRpcLogger.log(`[Python RPC stdout] ${data.toString()}`);
          });
        }

        this.logStderr(childProcess.stderr);

        childProcess.on("exit", (code, signal) => {
          pythonRpcLogger.error(
            `Python RPC process exited with code ${code} and signal ${signal}`
          );
          this.pythonProcess = null;
        });

        childProcess.on("error", (error) => {
          pythonRpcLogger.error("Python RPC process error:", error);
          this.pythonProcess = null;
        });

        this.pythonProcess = childProcess;
      } else {
        pythonRpcLogger.log(
          `Using Windows/Linux packaged build path (frozen binary mode)`
        );
        // Windows/Linux: use frozen binary
        const binaryName = binaryNameByPlatform[process.platform]!;
        const binaryPath = path.join(
          process.resourcesPath,
          "hydra-python-rpc",
          binaryName
        );

        pythonRpcLogger.log(`Looking for Python RPC binary at: ${binaryPath}`);
        pythonRpcLogger.log(`Resources path: ${process.resourcesPath}`);

        if (!fs.existsSync(binaryPath)) {
          const errorMsg = `Hydra Python RPC binary not found at: ${binaryPath}. Please ensure the binary is included in the app bundle.`;
          pythonRpcLogger.error(errorMsg);
          dialog.showErrorBox(
            "Fatal",
            process.platform === "win32"
              ? "Hydra Python Instance binary not found. Please check if it has been removed by Windows Defender."
              : errorMsg
          );

          app.quit();
          return;
        }

        // Ensure the binary has execute permissions on Linux
        if (process.platform === "linux") {
          try {
            fs.chmodSync(binaryPath, 0o755);
          } catch (error) {
            pythonRpcLogger.warn(
              `Failed to set execute permissions on binary: ${error}`
            );
          }
        }

        pythonRpcLogger.log(`Spawning Python RPC binary: ${binaryPath}`);
        const childProcess = cp.spawn(binaryPath, commonArgs, {
          windowsHide: true,
          stdio: ["pipe", "pipe", "pipe"],
          cwd: path.dirname(binaryPath),
        });

        if (childProcess.stdout) {
          childProcess.stdout.on("data", (data) => {
            pythonRpcLogger.log(`[Python RPC stdout] ${data.toString()}`);
          });
        }

        this.logStderr(childProcess.stderr);

        childProcess.on("exit", (code, signal) => {
          pythonRpcLogger.error(
            `Python RPC process exited with code ${code} and signal ${signal}`
          );
          this.pythonProcess = null;
        });

        childProcess.on("error", (error) => {
          pythonRpcLogger.error("Python RPC process error:", error);
          this.pythonProcess = null;
        });

        this.pythonProcess = childProcess;
      }
    } else {
      pythonRpcLogger.log(`Using development mode (Python script mode)`);
      const scriptPath = path.join(
        __dirname,
        "..",
        "..",
        "python_rpc",
        "main.py"
      );

      const pythonExecutable = await this.findPythonExecutable();
      pythonRpcLogger.log(`Using Python executable: ${pythonExecutable}`);

      const childProcess = cp.spawn(
        pythonExecutable,
        [scriptPath, ...commonArgs],
        {
          stdio: ["inherit", "inherit"],
        }
      );

      this.logStderr(childProcess.stderr);

      childProcess.on("exit", (code, signal) => {
        pythonRpcLogger.error(
          `Python RPC process exited with code ${code} and signal ${signal}`
        );
        this.pythonProcess = null;
      });

      childProcess.on("error", (error) => {
        pythonRpcLogger.error("Python RPC process error:", error);
        this.pythonProcess = null;
      });

      this.pythonProcess = childProcess;
    }

    this.rpc.defaults.headers.common["x-hydra-rpc-password"] = rpcPassword;

    const isReady = await this.waitForService();
    if (!isReady) {
      pythonRpcLogger.error("Python RPC service failed to start");
      throw new Error("Python RPC service failed to become ready");
    }
  }

  public static isRunning(): boolean {
    return this.pythonProcess !== null && !this.pythonProcess.killed;
  }

  public static async checkHealth(): Promise<boolean> {
    try {
      await this.rpc.get("/status");
      return true;
    } catch {
      return false;
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
