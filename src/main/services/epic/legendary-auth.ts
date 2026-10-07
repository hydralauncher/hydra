import {
  execFile,
  spawn,
  type ChildProcess,
  type ExecFileOptionsWithStringEncoding,
} from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import {
  EpicIntegrationError,
  isRecord,
  validateLegendarySession,
  validateLegendaryVersion,
} from "./auth-protocol.js";
import type { EpicSessionBundle } from "./store";

export const EPIC_LEGENDARY_PROCESS_TIMEOUT_MS = 60_000;
export const EPIC_LEGENDARY_API_TIMEOUT_SECONDS = 15;
const EPIC_LEGENDARY_MAX_OUTPUT_BYTES = 128 * 1024;
const EPIC_SESSION_MAX_FILE_BYTES = 1024 * 1024;
export const EPIC_LEGENDARY_TERMINATION_TIMEOUT_MS = 10_000;

export interface EpicSessionRunner {
  authenticate(code: string): Promise<EpicSessionBundle>;
  getExchangeCode(): Promise<string>;
  readBundle(): Promise<EpicSessionBundle>;
  cleanup(): Promise<void>;
}

export type LegendaryCommandExecutor = (
  binaryPath: string,
  args: string[],
  options: ExecFileOptionsWithStringEncoding
) => Promise<string>;

interface LegendaryProcessRuntime {
  platform: string;
  spawn: typeof spawn;
  killGroup: (pid: number, signal: NodeJS.Signals) => void;
  taskkill: (pid: number) => Promise<void>;
}

export function taskkillLegendaryTree(
  pid: number,
  run: typeof execFile = execFile
) {
  if (!Number.isSafeInteger(pid) || pid <= 0) {
    return Promise.reject(new EpicIntegrationError("cleanup-failed"));
  }
  return new Promise<void>((resolve, reject) => {
    const executable = path.win32.join(
      process.env.SystemRoot || "C:\\Windows",
      "System32",
      "taskkill.exe"
    );
    run(
      executable,
      ["/PID", String(pid), "/T", "/F"],
      {
        shell: false,
        windowsHide: true,
        timeout: EPIC_LEGENDARY_TERMINATION_TIMEOUT_MS,
        maxBuffer: 16 * 1024,
      },
      (error) => {
        if (error) reject(new EpicIntegrationError("cleanup-failed"));
        else resolve();
      }
    );
  });
}

class LegendaryProcessCleanupError extends EpicIntegrationError {
  constructor(public readonly retry: () => Promise<void>) {
    super("cleanup-failed");
  }
}

const defaultProcessRuntime: LegendaryProcessRuntime = {
  platform: process.platform,
  spawn,
  killGroup: (pid, signal) => {
    process.kill(pid, signal);
  },
  taskkill: taskkillLegendaryTree,
};

const waitForProcessClose = (closed: Promise<void>) =>
  new Promise<void>((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new EpicIntegrationError("cleanup-failed")),
      EPIC_LEGENDARY_TERMINATION_TIMEOUT_MS
    );
    void closed.then(() => {
      clearTimeout(timer);
      resolve();
    });
  });

/** PyInstaller onefile has a launcher parent and a Python child. Killing just
 * the parent does not stop authentication or writes to LEGENDARY_CONFIG_PATH. */
export function executeLegendaryCommand(
  binaryPath: string,
  args: string[],
  options: ExecFileOptionsWithStringEncoding,
  overrides: Partial<LegendaryProcessRuntime> = {}
): Promise<string> {
  const runtime = { ...defaultProcessRuntime, ...overrides };
  if (options.signal?.aborted)
    return Promise.reject(new EpicIntegrationError("operation-cancelled"));
  return new Promise((resolve, reject) => {
    let child: ChildProcess;
    try {
      child = runtime.spawn(binaryPath, args, {
        shell: false,
        windowsHide: true,
        // A new POSIX process group includes bootloader/Python descendants.
        detached: runtime.platform !== "win32",
        stdio: ["ignore", "pipe", "pipe"],
        env: options.env,
        cwd: options.cwd,
      });
    } catch {
      reject(new EpicIntegrationError("auth-failed"));
      return;
    }
    let output = "";
    let bytes = 0;
    let spawnFailed = false;
    let closed = false;
    let settled = false;
    let interruption:
      | "timeout"
      | "operation-cancelled"
      | "auth-failed"
      | undefined;
    let termination: Promise<void> | undefined;
    let completeClose!: () => void;
    const closedPromise = new Promise<void>((complete) => {
      completeClose = complete;
    });
    let timer: ReturnType<typeof setTimeout> | undefined;

    const settle = (error?: EpicIntegrationError) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      options.signal?.removeEventListener("abort", abort);
      if (error) {
        output = "";
        reject(error);
      } else resolve(output);
    };
    const terminate = async () => {
      if (closed) return;
      if (child.pid) {
        try {
          if (runtime.platform === "win32") await runtime.taskkill(child.pid);
          else runtime.killGroup(-child.pid, "SIGKILL");
        } catch (error) {
          // ESRCH means the entire POSIX group already stopped.
          if (!closed && (error as NodeJS.ErrnoException).code !== "ESRCH") {
            throw new EpicIntegrationError("cleanup-failed");
          }
        }
      }
      await waitForProcessClose(closedPromise);
    };
    const stop = (reason: NonNullable<typeof interruption>) => {
      interruption ??= reason;
      clearTimeout(timer);
      termination ??= terminate();
      void termination.then(
        () => settle(new EpicIntegrationError(interruption!)),
        () => settle(new LegendaryProcessCleanupError(terminate))
      );
    };
    const abort = () => stop("operation-cancelled");

    child.on("error", () => {
      spawnFailed = true;
    });
    child.stdout?.on("data", (chunk: Buffer) => {
      bytes += chunk.length;
      if (bytes > (options.maxBuffer ?? EPIC_LEGENDARY_MAX_OUTPUT_BYTES))
        stop("auth-failed");
      else if (!interruption) output += chunk.toString("utf8");
    });
    child.stderr?.on("data", (chunk: Buffer) => {
      bytes += chunk.length;
      if (bytes > (options.maxBuffer ?? EPIC_LEGENDARY_MAX_OUTPUT_BYTES))
        stop("auth-failed");
    });
    child.on("close", (code) => {
      closed = true;
      completeClose();
      if (!interruption)
        settle(
          spawnFailed || code !== 0
            ? new EpicIntegrationError("auth-failed")
            : undefined
        );
    });
    options.signal?.addEventListener("abort", abort, { once: true });
    if (options.signal?.aborted) abort();
    else if (options.timeout && options.timeout > 0)
      timer = setTimeout(() => stop("timeout"), options.timeout);
  });
}

const execute: LegendaryCommandExecutor = executeLegendaryCommand;

export const getEpicTemporaryRoot = (userDataPath: string) =>
  path.join(userDataPath, "epic-temporary");

export async function cleanupEpicTemporarySessions(userDataPath: string) {
  const root = getEpicTemporaryRoot(userDataPath);
  try {
    for (const entry of await fs.readdir(root, { withFileTypes: true })) {
      if (entry.name.startsWith("operation-")) {
        await fs.rm(path.join(root, entry.name), {
          recursive: true,
          force: true,
        });
      }
    }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
      throw new EpicIntegrationError("cleanup-failed");
    }
  }
}

export class LegendaryAuthRunner implements EpicSessionRunner {
  private pendingTermination?: () => Promise<void>;
  private constructor(
    private readonly binaryPath: string,
    private readonly directory: string,
    private readonly signal: AbortSignal,
    private readonly executor: LegendaryCommandExecutor
  ) {}

  public static async create(
    binaryPath: string,
    userDataPath: string,
    signal: AbortSignal,
    executor: LegendaryCommandExecutor = execute
  ) {
    if (signal.aborted) throw new EpicIntegrationError("operation-cancelled");
    const root = getEpicTemporaryRoot(userDataPath);
    let directory: string | undefined;
    try {
      await fs.mkdir(root, { recursive: true, mode: 0o700 });
      await fs.chmod(root, 0o700);
      directory = await fs.mkdtemp(path.join(root, "operation-"));
      await fs.chmod(directory, 0o700);
      await fs.writeFile(
        path.join(directory, "config.ini"),
        "[Legendary]\ndisable_update_check = true\ndisable_update_notice = true\ndisable_auto_aliasing = true\n",
        { mode: 0o600 }
      );
      if (signal.aborted) throw new EpicIntegrationError("operation-cancelled");
      return new LegendaryAuthRunner(binaryPath, directory, signal, executor);
    } catch {
      if (directory) {
        try {
          await fs.rm(directory, { recursive: true, force: true });
        } catch {
          /* Crash recovery retries this restricted directory. */
        }
      }
      throw new EpicIntegrationError(
        signal.aborted ? "operation-cancelled" : "persistence-failed"
      );
    }
  }

  private async run(args: string[]) {
    if (this.signal.aborted)
      throw new EpicIntegrationError("operation-cancelled");
    try {
      const output = await this.executor(
        this.binaryPath,
        ["--api-timeout", String(EPIC_LEGENDARY_API_TIMEOUT_SECONDS), ...args],
        {
          shell: false,
          timeout: EPIC_LEGENDARY_PROCESS_TIMEOUT_MS,
          windowsHide: true,
          maxBuffer: EPIC_LEGENDARY_MAX_OUTPUT_BYTES,
          encoding: "utf8",
          signal: this.signal,
          killSignal: "SIGKILL",
          env: { ...process.env, LEGENDARY_CONFIG_PATH: this.directory },
        }
      );
      if (this.signal.aborted)
        throw new EpicIntegrationError("operation-cancelled");
      return output;
    } catch (error) {
      if (error instanceof LegendaryProcessCleanupError) {
        this.pendingTermination = error.retry;
        throw new EpicIntegrationError("cleanup-failed");
      }
      if (error instanceof EpicIntegrationError) throw error;
      throw new EpicIntegrationError(
        this.signal.aborted ? "operation-cancelled" : "auth-failed"
      );
    }
  }

  public async authenticate(code: string) {
    // Never restore an old user.json into an authentication attempt.
    try {
      await fs.access(path.join(this.directory, "user.json"));
      throw new EpicIntegrationError("auth-failed");
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
    await this.run(["auth", "--code", code]);
    return this.readBundle();
  }

  private async readJson(name: string) {
    try {
      const file = path.join(this.directory, name);
      const stat = await fs.lstat(file);
      if (
        !stat.isFile() ||
        stat.isSymbolicLink() ||
        stat.size > EPIC_SESSION_MAX_FILE_BYTES
      ) {
        throw new Error("invalid-file");
      }
      await fs.chmod(file, 0o600);
      return JSON.parse(await fs.readFile(file, "utf8")) as unknown;
    } catch {
      throw new EpicIntegrationError("auth-failed");
    }
  }

  public async readBundle(): Promise<EpicSessionBundle> {
    if (this.signal.aborted)
      throw new EpicIntegrationError("operation-cancelled");
    return {
      user: validateLegendarySession(await this.readJson("user.json")),
      version: validateLegendaryVersion(await this.readJson("version.json")),
    };
  }

  public async getExchangeCode() {
    const output = await this.run(["get-token", "--json"]);
    try {
      const token: unknown = JSON.parse(output);
      if (
        !isRecord(token) ||
        typeof token.code !== "string" ||
        !/^[a-zA-Z0-9_-]{16,512}$/.test(token.code)
      ) {
        throw new Error("invalid-code");
      }
      return token.code;
    } catch {
      throw new EpicIntegrationError("invalid-response");
    }
  }

  public async cleanup() {
    try {
      await this.pendingTermination?.();
      this.pendingTermination = undefined;
      await fs.rm(this.directory, { recursive: true, force: true });
    } catch {
      throw new EpicIntegrationError("cleanup-failed");
    }
  }
}
