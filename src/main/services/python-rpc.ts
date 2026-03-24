import cp from "node:child_process";
import fs from "node:fs";
import path from "node:path";

import { pythonRpcLogger } from "./logger";
import { Readable } from "node:stream";
import { app, dialog } from "electron";

interface GamePayload {
  action: string;
  game_id: string;
  url: string | string[];
  save_path: string;
  header?: string;
  out?: string;
  total_size?: number;
  file_indices?: number[];
  metadata_timeout_ms?: number;
}

const binaryNameByPlatform: Partial<Record<NodeJS.Platform, string>> = {
  darwin: "hydra-python-rpc",
  linux: "hydra-python-rpc",
  win32: "hydra-python-rpc.exe",
};

type PythonRpcMethod = "status" | "seed_status" | "torrent_files" | "action";

type PythonRpcResponse<T = unknown> =
  | {
      id: number;
      result: T;
    }
  | {
      id: number;
      error: {
        code: string;
        message: string;
      };
    }
  | {
      event: "ready";
      protocolVersion: number;
    };

type PendingRpcRequest = {
  resolve: (value: unknown) => void;
  reject: (reason?: unknown) => void;
  timer: NodeJS.Timeout;
};

type RpcRequestConfig = {
  timeout?: number;
};

export class PythonRpcError extends Error {
  public readonly code: string;

  public readonly response: {
    data: {
      error: string;
    };
  };

  constructor(code: string, message?: string) {
    super(message || code);
    this.name = "PythonRpcError";
    this.code = code;
    this.response = {
      data: {
        error: code,
      },
    };
  }
}

export class PythonRPC {
  public static readonly BITTORRENT_PORT = "5881";

  public static readonly rpc = {
    call: async <T>(
      method: PythonRpcMethod,
      params?: unknown,
      config?: RpcRequestConfig
    ) => {
      const data = await this.request<T>(method, params, {
        timeout: config?.timeout,
      });

      return { data };
    },
  };

  private static pythonProcess: cp.ChildProcess | null = null;
  private static pendingRequests = new Map<number, PendingRpcRequest>();
  private static nextRequestId = 1;
  private static stdoutBuffer = "";
  private static rpcPassword = "";
  private static pythonExecutable: string | null = null;
  private static ready = false;
  private static readyPromise: Promise<void> | null = null;
  private static readyResolver: (() => void) | null = null;
  private static readyRejecter: ((error: unknown) => void) | null = null;

  private static logStderr(readable: Readable | null) {
    if (!readable) return;

    readable.setEncoding("utf-8");
    readable.on("data", pythonRpcLogger.log);
  }

  private static logStdout(readable: Readable | null) {
    if (!readable) return;

    readable.setEncoding("utf-8");
    readable.on("data", (chunk: string) => {
      this.stdoutBuffer += chunk;
      this.processStdoutBuffer();
    });
  }

  private static processStdoutBuffer() {
    let newlineIndex = this.stdoutBuffer.indexOf("\n");

    while (newlineIndex >= 0) {
      const rawLine = this.stdoutBuffer.slice(0, newlineIndex);
      this.stdoutBuffer = this.stdoutBuffer.slice(newlineIndex + 1);
      this.handleStdoutLine(rawLine);
      newlineIndex = this.stdoutBuffer.indexOf("\n");
    }
  }

  private static handleStdoutLine(line: string) {
    const payload = line.trim();
    if (!payload) return;

    let parsed: PythonRpcResponse;
    try {
      parsed = JSON.parse(payload) as PythonRpcResponse;
    } catch {
      pythonRpcLogger.error(`Failed to parse RPC stdout line: ${payload}`);
      return;
    }

    if ("event" in parsed && parsed.event === "ready") {
      this.markReady();
      return;
    }

    if (!("id" in parsed) || typeof parsed.id !== "number") {
      pythonRpcLogger.error(`Unexpected RPC message: ${payload}`);
      return;
    }

    const pending = this.pendingRequests.get(parsed.id);
    if (!pending) {
      pythonRpcLogger.error(`No pending request for RPC id ${parsed.id}`);
      return;
    }

    clearTimeout(pending.timer);
    this.pendingRequests.delete(parsed.id);

    if ("error" in parsed) {
      pending.reject(
        new PythonRpcError(parsed.error.code, parsed.error.message)
      );
      return;
    }

    pending.resolve(parsed.result);
  }

  private static markReady() {
    if (this.ready) return;

    this.ready = true;
    if (this.readyResolver) {
      this.readyResolver();
    }

    this.readyResolver = null;
    this.readyRejecter = null;
  }

  private static resetReadyState() {
    this.ready = false;
    this.readyPromise = new Promise<void>((resolve, reject) => {
      this.readyResolver = resolve;
      this.readyRejecter = reject;
    });
  }

  private static rejectAllPendingRequests(error: unknown) {
    for (const pending of this.pendingRequests.values()) {
      clearTimeout(pending.timer);
      pending.reject(error);
    }

    this.pendingRequests.clear();
  }

  private static handleProcessExit(reason: string) {
    const error = new Error(`Python RPC exited: ${reason}`);

    this.rejectAllPendingRequests(error);

    if (this.readyRejecter && !this.ready) {
      this.readyRejecter(error);
    }

    this.readyPromise = null;
    this.readyResolver = null;
    this.readyRejecter = null;
    this.ready = false;
    this.stdoutBuffer = "";
    this.pythonProcess = null;
  }

  private static async request<T>(
    method: PythonRpcMethod,
    params?: unknown,
    config?: RpcRequestConfig
  ): Promise<T> {
    if (!this.pythonProcess) {
      await this.spawn();
    }

    try {
      await this.ensureReady();
    } catch (error) {
      pythonRpcLogger.error("Python RPC not ready, restarting process", error);
      this.kill();
      await this.spawn();
      await this.ensureReady();
    }

    if (!this.pythonProcess || !this.pythonProcess.stdin) {
      throw new Error("Python RPC process is not available");
    }

    const timeoutMs = Math.max(config?.timeout ?? 10_000, 1_000);
    const id = this.nextRequestId++;
    const payload = {
      id,
      method,
      params: params ?? {},
      rpc_password: this.rpcPassword,
    };

    return new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pendingRequests.delete(id);
        reject(new Error(`Python RPC timeout for method '${method}'`));
      }, timeoutMs);

      this.pendingRequests.set(id, {
        resolve: resolve as (value: unknown) => void,
        reject,
        timer,
      });

      const requestLine = `${JSON.stringify(payload)}\n`;
      const didWrite = this.pythonProcess?.stdin?.write(requestLine);

      if (!didWrite) {
        this.pythonProcess?.stdin?.once("drain", () => {
          // Request remains pending and will resolve when response arrives.
        });
      }
    });
  }

  public static async ensureReady(timeoutMs = 10_000): Promise<void> {
    if (this.ready) return;

    if (!this.readyPromise) {
      throw new Error("Python RPC process is not running");
    }

    await Promise.race([
      this.readyPromise,
      new Promise<void>((_, reject) => {
        setTimeout(
          () => reject(new Error("Python RPC startup timeout")),
          timeoutMs
        );
      }),
    ]);
  }

  public static async spawn(
    initialDownload?: GamePayload,
    initialSeeding?: GamePayload[]
  ) {
    if (this.pythonProcess) {
      await this.ensureReady().catch(() => {
        this.kill();
      });

      if (this.pythonProcess) return;
    }

    this.rpcPassword = Math.random().toString(36).slice(2);

    this.resetReadyState();
    this.stdoutBuffer = "";

    const commonArgs = [
      this.BITTORRENT_PORT,
      this.rpcPassword,
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
        throw new Error(`Hydra Python RPC binary not found at ${binaryPath}`);
      }

      const childProcess = cp.spawn(binaryPath, commonArgs, {
        windowsHide: true,
        stdio: ["pipe", "pipe", "pipe"],
      });

      this.logStderr(childProcess.stderr);
      this.logStdout(childProcess.stdout);

      this.pythonProcess = childProcess;
    } else {
      const pythonExecutable = this.resolvePythonExecutable();
      const scriptPath = path.join(
        __dirname,
        "..",
        "..",
        "python_rpc",
        "main.py"
      );

      const childProcess = cp.spawn(
        pythonExecutable,
        [scriptPath, ...commonArgs],
        {
          stdio: ["pipe", "pipe", "pipe"],
        }
      );

      this.logStderr(childProcess.stderr);
      this.logStdout(childProcess.stdout);

      this.pythonProcess = childProcess;
    }

    this.pythonProcess.once("error", (error) => {
      this.handleProcessExit(String(error));
    });

    this.pythonProcess.once("exit", (code, signal) => {
      this.handleProcessExit(
        `code=${code ?? "null"} signal=${signal ?? "null"}`
      );
    });

    if (!this.pythonProcess) {
      throw new Error("Failed to start Python RPC process");
    }

    await this.ensureReady();
  }

  private static resolvePythonExecutable() {
    if (this.pythonExecutable) {
      return this.pythonExecutable;
    }

    const candidates = [
      process.env.HYDRA_PYTHON_BIN,
      process.env.PYTHON,
      "python3",
      "python",
    ].filter((value): value is string => Boolean(value));

    for (const candidate of candidates) {
      const check = cp.spawnSync(candidate, ["--version"], {
        stdio: "ignore",
      });

      if (!check.error) {
        this.pythonExecutable = candidate;
        return candidate;
      }
    }

    throw new Error(
      "Python executable not found. Set HYDRA_PYTHON_BIN or install python3/python."
    );
  }

  public static kill() {
    if (this.pythonProcess) {
      pythonRpcLogger.log("Killing python process");
      this.pythonProcess.kill();
    }

    this.handleProcessExit("killed");
  }
}
