import cp from "node:child_process";
import fs from "node:fs";
import path from "node:path";

import { streamSidecarLogger } from "./logger";
import { Readable } from "node:stream";
import { app } from "electron";
import {
  createStdoutLineBuffer,
  logReadable,
  ReadyState,
  rejectPendingRequests,
  type PendingRpcRequest,
  type RpcResponseEnvelope,
} from "./child-process-rpc";

const binaryNameByPlatform: Partial<Record<NodeJS.Platform, string>> = {
  darwin: "hydra-stream",
  linux: "hydra-stream",
  win32: "hydra-stream.exe",
};

/** Startup handshake budget: a child that never reports ready is killed. */
const SIDECAR_READY_TIMEOUT_MS = 10_000;
/** Default RPC timeout, and the floor any caller-supplied value is raised to. */
const SIDECAR_REQUEST_TIMEOUT_MS = 10_000;
const SIDECAR_MIN_REQUEST_TIMEOUT_MS = 1_000;

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
      /** Why the session ended: only "cancel" means the client quit. */
      reason: string;
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
  | RpcResponseEnvelope<T>
  | StreamSidecarEvent;

export class StreamSidecar {
  private static childProcess: cp.ChildProcess | null = null;
  private static readonly pendingRequests = new Map<
    number,
    PendingRpcRequest
  >();
  private static nextRequestId = 1;
  private static readonly stdoutLines = createStdoutLineBuffer((line) =>
    this.handleStdoutLine(line)
  );
  private static readonly readyState = new ReadyState();
  private static readonly eventListeners = new Set<
    (event: StreamSidecarEvent) => void
  >();
  private static readonly exitListeners = new Set<(reason: string) => void>();

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
    logReadable(readable, streamSidecarLogger.log);
  }

  private static logStdout(readable: Readable | null) {
    logReadable(readable, (chunk) => this.stdoutLines.append(chunk));
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
        this.readyState.markReady();
        return;
      }

      for (const listener of this.eventListeners) {
        listener(parsed);
      }
      return;
    }

    streamSidecarLogger.error(`Unexpected RPC message: ${payload}`);
  }

  private static handleProcessExit(
    childProcess: cp.ChildProcess,
    reason: string
  ) {
    // Exactly one teardown per child. A child that already exited, was
    // killed, timed out, or was replaced must not clear the state of its
    // successor or notify a second time.
    if (this.childProcess !== childProcess) return;

    const error = new Error(`Stream sidecar exited: ${reason}`);

    rejectPendingRequests(this.pendingRequests, error);
    this.readyState.rejectIfNotReady(error);
    this.readyState.clear();
    this.stdoutLines.reset();
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

  private static async ensureReady(
    timeoutMs = SIDECAR_READY_TIMEOUT_MS
  ): Promise<void> {
    return this.readyState.wait(
      timeoutMs,
      "Stream sidecar process is not running",
      "Stream sidecar startup timeout"
    );
  }

  public static onEvent(listener: (event: StreamSidecarEvent) => void) {
    this.eventListeners.add(listener);
    return () => this.eventListeners.delete(listener);
  }

  /** Whether a sidecar process is alive (request() would spawn otherwise). */
  public static isRunning() {
    return this.childProcess !== null;
  }

  public static async spawn() {
    if (this.childProcess) return;

    this.readyState.reset();
    this.stdoutLines.reset();

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
      this.handleProcessExit(childProcess, String(error));
    });

    this.childProcess.once("exit", (code, signal) => {
      this.handleProcessExit(
        childProcess,
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
        this.handleProcessExit(childProcess, "startup-timeout");
      }
      throw error;
    }
  }

  public static async request<T>(
    method: string,
    params?: unknown,
    timeoutMs = SIDECAR_REQUEST_TIMEOUT_MS
  ): Promise<T> {
    if (!this.childProcess) {
      await this.spawn();
    }

    if (!this.childProcess?.stdin) {
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
        Math.max(timeoutMs, SIDECAR_MIN_REQUEST_TIMEOUT_MS)
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
    const childProcess = this.childProcess;
    if (!childProcess) return;

    streamSidecarLogger.log("Killing stream sidecar process");
    childProcess.kill();
    this.handleProcessExit(childProcess, "killed");
  }
}
