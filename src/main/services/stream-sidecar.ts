import cp from "node:child_process";
import fs from "node:fs";
import path from "node:path";

import { streamSidecarLogger } from "./logger";
import { Readable } from "node:stream";
import { app } from "electron";

const binaryNameByPlatform: Partial<Record<NodeJS.Platform, string>> = {
  darwin: "hydra-stream",
  linux: "hydra-stream",
  win32: "hydra-stream.exe",
};

export type StreamSidecarEvent =
  | {
      event: "ready";
      protocolVersion: number;
    }
  | {
      event: "pairing-requested";
    }
  | {
      event: "pairing-finished";
      success: boolean;
    }
  | {
      event: "session-state";
      state: string;
    }
  | {
      event: "launch-requested";
      appid: number;
    }
  | {
      event: "stream-ended";
      appid: number;
    }
  | {
      event: "client-connected";
      appid: number;
      uniqueid: string;
      width: number;
      height: number;
      fps: number;
    }
  | {
      event: "client-disconnected";
      reason: string;
    };

type StreamRpcResponse<T = unknown> =
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
  | StreamSidecarEvent;

type PendingRpcRequest = {
  resolve: (value: unknown) => void;
  reject: (reason?: unknown) => void;
  timer: NodeJS.Timeout;
};

export class StreamSidecar {
  private static childProcess: cp.ChildProcess | null = null;
  private static pendingRequests = new Map<number, PendingRpcRequest>();
  private static nextRequestId = 1;
  private static stdoutBuffer = "";
  private static ready = false;
  private static readyPromise: Promise<void> | null = null;
  private static readyResolver: (() => void) | null = null;
  private static readyRejecter: ((error: unknown) => void) | null = null;
  private static eventListeners = new Set<
    (event: StreamSidecarEvent) => void
  >();
  private static exitListeners = new Set<(reason: string) => void>();

  private static resolveBinaryPath() {
    const binaryName = binaryNameByPlatform[process.platform];

    if (!binaryName) {
      throw new Error(`Unsupported platform: ${process.platform}`);
    }

    if (app.isPackaged) {
      return path.join(process.resourcesPath, "hydra-stream", binaryName);
    }

    return path.join(app.getAppPath(), "hydra-stream", binaryName);
  }

  private static logStderr(readable: Readable | null) {
    if (!readable) return;

    readable.setEncoding("utf-8");
    readable.on("data", streamSidecarLogger.log);
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

    let parsed: StreamRpcResponse;
    try {
      parsed = JSON.parse(payload) as StreamRpcResponse;
    } catch {
      streamSidecarLogger.error(`Failed to parse RPC stdout line: ${payload}`);
      return;
    }

    if ("id" in parsed && typeof parsed.id === "number") {
      const pending = this.pendingRequests.get(parsed.id);
      if (!pending) {
        streamSidecarLogger.error(`No pending request for RPC id ${parsed.id}`);
        return;
      }

      clearTimeout(pending.timer);
      this.pendingRequests.delete(parsed.id);

      if ("error" in parsed) {
        pending.reject(new Error(parsed.error.message || parsed.error.code));
        return;
      }

      pending.resolve(parsed.result);
      return;
    }

    if ("event" in parsed) {
      if (parsed.event === "ready") {
        this.markReady();
        return;
      }

      for (const listener of this.eventListeners) {
        listener(parsed);
      }
      return;
    }

    streamSidecarLogger.error(`Unexpected RPC message: ${payload}`);
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
    const error = new Error(`Stream sidecar exited: ${reason}`);

    this.rejectAllPendingRequests(error);

    if (this.readyRejecter && !this.ready) {
      this.readyRejecter(error);
    }

    this.readyPromise = null;
    this.readyResolver = null;
    this.readyRejecter = null;
    this.ready = false;
    this.stdoutBuffer = "";
    this.childProcess = null;

    // unexpected exits (not an explicit kill) notify subscribers so the
    // manager can reset state and respawn
    if (reason !== "killed") {
      for (const listener of this.exitListeners) {
        listener(reason);
      }
    }
  }

  public static onExit(listener: (reason: string) => void) {
    this.exitListeners.add(listener);
    return () => this.exitListeners.delete(listener);
  }

  private static async ensureReady(timeoutMs = 10_000): Promise<void> {
    if (this.ready) return;

    if (!this.readyPromise) {
      throw new Error("Stream sidecar process is not running");
    }

    await Promise.race([
      this.readyPromise,
      new Promise<void>((_, reject) => {
        setTimeout(
          () => reject(new Error("Stream sidecar startup timeout")),
          timeoutMs
        );
      }),
    ]);
  }

  public static onEvent(listener: (event: StreamSidecarEvent) => void) {
    this.eventListeners.add(listener);
    return () => this.eventListeners.delete(listener);
  }

  public static async spawn() {
    if (this.childProcess) return;

    this.resetReadyState();
    this.stdoutBuffer = "";

    const binaryPath = this.resolveBinaryPath();

    if (!fs.existsSync(binaryPath)) {
      throw new Error(`Stream sidecar binary not found at ${binaryPath}`);
    }

    const childProcess = cp.spawn(binaryPath, [], {
      windowsHide: true,
      stdio: ["pipe", "pipe", "pipe"],
    });

    this.logStderr(childProcess.stderr);
    this.logStdout(childProcess.stdout);

    this.childProcess = childProcess;

    this.childProcess.once("error", (error) => {
      this.handleProcessExit(String(error));
    });

    this.childProcess.once("exit", (code, signal) => {
      this.handleProcessExit(
        `code=${code ?? "null"} signal=${signal ?? "null"}`
      );
    });

    // never leave a hung child around: on startup timeout, kill it and
    // let the caller decide whether to retry
    try {
      await this.ensureReady();
    } catch (error) {
      if (this.childProcess === childProcess) {
        streamSidecarLogger.error(
          "Stream sidecar startup timed out; killing the hung process",
          error
        );
        childProcess.kill();
        this.handleProcessExit("startup-timeout");
      }
      throw error;
    }
  }

  public static async request<T>(
    method: string,
    params?: unknown,
    timeoutMs = 10_000
  ): Promise<T> {
    if (!this.childProcess) {
      await this.spawn();
    }

    if (!this.childProcess || !this.childProcess.stdin) {
      throw new Error("Stream sidecar process is not available");
    }

    const id = this.nextRequestId++;
    const payload = {
      id,
      method,
      params: params ?? {},
    };

    return new Promise<T>((resolve, reject) => {
      const timer = setTimeout(
        () => {
          this.pendingRequests.delete(id);
          reject(new Error(`Stream sidecar timeout for method '${method}'`));
        },
        Math.max(timeoutMs, 1_000)
      );

      this.pendingRequests.set(id, {
        resolve: resolve as (value: unknown) => void,
        reject,
        timer,
      });

      this.childProcess?.stdin?.write(`${JSON.stringify(payload)}\n`);
    });
  }

  public static ping(timeoutMs?: number): Promise<string> {
    return this.request<string>("ping", undefined, timeoutMs);
  }

  public static kill() {
    if (this.childProcess) {
      streamSidecarLogger.log("Killing stream sidecar process");
      this.childProcess.kill();
    }

    this.handleProcessExit("killed");
  }
}
