import { createHash } from "node:crypto";
import { spawn, execFile, type ChildProcess } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { StringDecoder } from "node:string_decoder";
import type {
  EpicLocalOwner,
  EpicInstallPlatform,
  EpicInstallError,
} from "../../../types/epic-managed.types";
import type { EpicConnectedConnection } from "../../../types/epic-integration.types";
import type { EpicAuthContext } from "./integration-core";
import type { EpicSessionProvider } from "./session-provider";
import type { EpicSessionBundle } from "./store";
import {
  EpicIntegrationError,
  validateLegendarySession,
  validateLegendaryVersion,
} from "./auth-protocol.js";
import {
  EPIC_LEGENDARY_API_TIMEOUT_SECONDS,
  EPIC_LEGENDARY_MAX_OUTPUT_BYTES,
  EPIC_SESSION_MAX_FILE_BYTES,
} from "./legendary-auth.js";
import {
  EPIC_DOWNLOAD_STALL_TIMEOUT_MS,
  EPIC_PROCESS_MAX_LINE_BYTES,
  EPIC_PROCESS_TERMINATION_TIMEOUT_MS,
  EPIC_SYNC_MAX_OUTPUT_BYTES,
  EPIC_SYNC_TIMEOUT_MS,
} from "./constants.js";
import { getManagedEpicProcessCommand } from "./windows-process-job.js";
import {
  EpicTargetRuntime,
  type EpicManagedCommand,
} from "./target-runtime.js";
import { queueEpicOperation } from "./operation-queue.js";
import { markEpicTiming, withEpicTiming } from "./timing.js";

const commandTiming = (args: string[]) => {
  let index = args[0] === "--api-timeout" ? 2 : 0;
  if (args[index] === "-y") index++;
  const command = args[index];
  return command === "list" || command === "info" || command === "install"
    ? command
    : "other";
};

export class EpicManagedError extends Error {
  constructor(public readonly code: EpicInstallError) {
    super(code);
    this.name = "EpicManagedError";
  }
}

export class EpicManagedSpawnError extends EpicManagedError {
  constructor(public readonly nativeCode?: string) {
    super("process-failed");
  }
}

export function epicManagedErrorCode(error: unknown): EpicInstallError {
  if (
    error instanceof EpicManagedError ||
    error instanceof EpicIntegrationError
  )
    return error.code;
  if (error && typeof error === "object" && "isAxiosError" in error) {
    const response = "response" in error ? error.response : null;
    if (
      response &&
      typeof response === "object" &&
      "status" in response &&
      response.status === 401
    )
      return "hydra-auth-required";
    return "network";
  }
  return "process-failed";
}

const classifyLegendaryFailure = (stderr: string): EpicInstallError => {
  const managed = /^HYDRA_MANAGED_ERROR:([a-z-]+)$/m.exec(stderr)?.[1];
  if (
    managed &&
    [
      "session-expired",
      "invalid-artifact",
      "not-installable",
      "external-launcher-required",
      "invalid-response",
      "network",
      "operation-cancelled",
      "update-required",
    ].includes(managed)
  )
    return managed as EpicInstallError;
  if (
    /Game is out of date|please update (?:the game|before launching)/i.test(
      stderr
    )
  )
    return "update-required";
  if (
    /Log ?in failed|Failed to login|Authentication failed|Invalid refresh token/i.test(
      stderr
    )
  )
    return "session-expired";
  if (
    /ConnectionError|ReadTimeout|Failed to establish a new connection/i.test(
      stderr
    )
  )
    return "network";
  if (/not enough (?:free |disk )?space|insufficient disk space/i.test(stderr))
    return "insufficient-space";
  return "process-failed";
};

export interface EpicManagedTarget {
  auth: EpicAuthContext;
  connection: EpicConnectedConnection;
  owner: EpicLocalOwner;
  artifactId: string;
  platform: EpicInstallPlatform;
  localOnly?: true;
}

export const epicOwnerMatches = (left: EpicLocalOwner, right: EpicLocalOwner) =>
  left.environment === right.environment &&
  left.userId === right.userId &&
  left.epicAccountId === right.epicAccountId;

export function managedWorkspacePath(
  userData: string,
  owner: EpicLocalOwner,
  artifactId: string,
  platform: EpicInstallPlatform
) {
  const hash = (value: unknown) =>
    createHash("sha256").update(JSON.stringify(value)).digest("hex");
  return path.join(
    userData,
    "epic-managed",
    hash([owner.environment, owner.userId, owner.epicAccountId]),
    hash([artifactId, platform])
  );
}

/** Streaming CLI emits CR and LF boundaries. No unbounded output accumulation. */
export class LegendaryLineDecoder {
  private readonly decoder = new StringDecoder("utf8");
  private pending = "";
  constructor(private readonly onLine: (line: string) => void) {}
  push(chunk: Buffer) {
    this.pending += this.decoder.write(chunk);
    this.flush(false);
  }
  end() {
    this.pending += this.decoder.end();
    this.flush(true);
  }
  private flush(final: boolean) {
    const parts = this.pending.split(/[\r\n]/);
    this.pending = parts.pop() ?? "";
    for (const line of parts) {
      if (Buffer.byteLength(line) > EPIC_PROCESS_MAX_LINE_BYTES)
        throw new EpicManagedError("invalid-response");
      if (line) this.onLine(line);
    }
    if (Buffer.byteLength(this.pending) > EPIC_PROCESS_MAX_LINE_BYTES)
      throw new EpicManagedError("invalid-response");
    if (final && this.pending) {
      this.onLine(this.pending);
      this.pending = "";
    }
  }
}

interface ProcessOptions {
  signal: AbortSignal;
  timeout?: number;
  maxOutputBytes?: number;
  streaming?: boolean;
  onLine?: (line: string) => void;
  spawnProcess?: typeof spawn;
  env?: NodeJS.ProcessEnv;
  successExitCodes?: number[];
  supervisorDirectory?: string;
}

let managedSupervisorDirectory = path.resolve(
  "legendary",
  "win32",
  process.arch
);
export function configureManagedEpicProcessSupervisor(directory: string) {
  managedSupervisorDirectory = directory;
}

/** Returns only after the full bootloader/process tree has stopped. */
export async function executeManagedLegendary(
  binary: string,
  args: string[],
  directory: string,
  options: ProcessOptions
): Promise<{ stdout: string; stderr: string }> {
  if (options.signal.aborted) throw new EpicManagedError("operation-cancelled");
  const jobDirectory =
    process.platform === "win32" && !options.spawnProcess
      ? await withEpicTiming("process.windows.job-directory", () =>
          fs.mkdtemp(path.join(os.tmpdir(), "hydra-epic-process-"))
        )
      : null;
  const cancellation = jobDirectory ? path.join(jobDirectory, "cancel") : null;
  if (jobDirectory) await fs.chmod(jobDirectory, 0o700);
  try {
    const command =
      jobDirectory && cancellation
        ? await withEpicTiming("process.windows.supervisor-request", () =>
            getManagedEpicProcessCommand(
              options.supervisorDirectory ?? managedSupervisorDirectory,
              binary,
              args,
              cancellation
            )
          )
        : { binary, args };
    return await withEpicTiming(
      jobDirectory ? "process.native-supervisor" : "process.legendary",
      () =>
        new Promise<{ stdout: string; stderr: string }>((resolve, reject) => {
          let child: ChildProcess;
          try {
            markEpicTiming("process.spawn.requested");
            child = (options.spawnProcess ?? spawn)(
              command.binary,
              command.args,
              {
                shell: false,
                windowsHide: true,
                detached: process.platform !== "win32",
                stdio: ["ignore", "pipe", "pipe"],
                env: {
                  ...process.env,
                  ...options.env,
                  LEGENDARY_CONFIG_PATH:
                    process.platform === "win32"
                      ? path.toNamespacedPath(directory)
                      : directory,
                },
              }
            );
            child.once("spawn", () => markEpicTiming("process.spawned"));
          } catch {
            reject(new EpicManagedError("process-failed"));
            return;
          }
          let stdout = "";
          let stderr = "";
          let bytes = 0;
          let hasStdout = false;
          let hasStderr = false;
          let failure: unknown;
          let stopped = false;
          let stopping: Promise<void> | undefined;
          let timeout: ReturnType<typeof setTimeout> | undefined;
          let activityTimer: ReturnType<typeof setTimeout> | undefined;
          let completeClose!: () => void;
          const closed = new Promise<void>((done) => {
            completeClose = done;
          });
          const closeDeadline = async () => {
            let deadline: ReturnType<typeof setTimeout> | undefined;
            try {
              await Promise.race([
                closed,
                new Promise<never>((_, fail) => {
                  deadline = setTimeout(
                    () => fail(new EpicManagedError("cleanup-failed")),
                    EPIC_PROCESS_TERMINATION_TIMEOUT_MS
                  );
                }),
              ]);
            } finally {
              clearTimeout(deadline);
            }
          };
          const stopTree = async () => {
            if (stopped) return;
            if (cancellation) {
              await fs.writeFile(cancellation, "cancel", { mode: 0o600 });
            } else if (child.pid) {
              try {
                if (process.platform === "win32") {
                  const killer = path.win32.join(
                    process.env.SystemRoot || String.raw`C:\Windows`,
                    "System32",
                    "taskkill.exe"
                  );
                  await new Promise<void>((done, fail) =>
                    execFile(
                      killer,
                      ["/PID", String(child.pid), "/T", "/F"],
                      {
                        windowsHide: true,
                        shell: false,
                        timeout: EPIC_PROCESS_TERMINATION_TIMEOUT_MS,
                        maxBuffer: EPIC_LEGENDARY_MAX_OUTPUT_BYTES,
                      },
                      (error) =>
                        error
                          ? fail(new EpicManagedError("cleanup-failed"))
                          : done()
                    )
                  );
                } else process.kill(-child.pid, "SIGKILL");
              } catch (error) {
                if (
                  !stopped &&
                  (error as NodeJS.ErrnoException).code !== "ESRCH"
                )
                  throw error;
              }
            }
            try {
              await closeDeadline();
            } catch {
              // A delayed termination keeps the process lease and workspace occupied.
              // Never clear credentials or release a slot while a job can still run.
              await closed;
            }
          };
          const interrupt = (error: unknown) => {
            failure ??= error;
            stopping ??= stopTree();
            void stopping.catch((cleanupError) => {
              failure = cleanupError;
            });
          };
          const abort = () =>
            interrupt(new EpicManagedError("operation-cancelled"));
          const touch = () => {
            if (!options.streaming) return;
            clearTimeout(activityTimer);
            activityTimer = setTimeout(
              () => interrupt(new EpicManagedError("timeout")),
              EPIC_DOWNLOAD_STALL_TIMEOUT_MS
            );
          };
          const line = (value: string) => {
            options.onLine?.(value);
          };
          const outDecoder = new LegendaryLineDecoder(line);
          const errDecoder = new LegendaryLineDecoder(line);
          const rawOutDecoder = new StringDecoder("utf8");
          const rawErrDecoder = new StringDecoder("utf8");
          const collect = (chunk: Buffer, output: "stdout" | "stderr") => {
            try {
              if (output === "stdout" && !hasStdout) {
                hasStdout = true;
                markEpicTiming("process.first-stdout", { first: true });
              } else if (output === "stderr" && !hasStderr) {
                hasStderr = true;
                markEpicTiming("process.first-stderr", { first: true });
              }
              touch();
              bytes += chunk.length;
              if (options.streaming) {
                (output === "stdout" ? outDecoder : errDecoder).push(chunk);
                if (output === "stderr")
                  stderr = (stderr + chunk.toString("utf8")).slice(
                    -EPIC_LEGENDARY_MAX_OUTPUT_BYTES
                  );
                // Streaming commands do not expose diagnostic logs or auth material.
              } else {
                if (
                  bytes > (options.maxOutputBytes ?? EPIC_SYNC_MAX_OUTPUT_BYTES)
                )
                  throw new EpicManagedError("invalid-response");
                if (output === "stdout") stdout += rawOutDecoder.write(chunk);
                else stderr += rawErrDecoder.write(chunk);
              }
            } catch (error) {
              interrupt(error);
            }
          };
          child.stdout?.on("data", (chunk: Buffer) => collect(chunk, "stdout"));
          child.stderr?.on("data", (chunk: Buffer) => collect(chunk, "stderr"));
          child.once("error", (error: NodeJS.ErrnoException) => {
            failure ??= new EpicManagedSpawnError(error.code);
          });
          child.once("close", (code) => {
            markEpicTiming("process.closed", { bytes });
            stopped = true;
            completeClose();
            clearTimeout(timeout);
            clearTimeout(activityTimer);
            options.signal.removeEventListener("abort", abort);
            try {
              if (options.streaming) {
                outDecoder.end();
                errDecoder.end();
              } else {
                stdout += rawOutDecoder.end();
                stderr += rawErrDecoder.end();
              }
            } catch (error) {
              failure ??= error;
            }
            void (stopping ?? Promise.resolve()).then(() => {
              if (failure) reject(failure);
              else if (/HYDRA_PROCESS_SPAWN_ERROR:(\d+)/.test(stderr)) {
                const native = Number(
                  /HYDRA_PROCESS_SPAWN_ERROR:(\d+)/.exec(stderr)![1]
                );
                reject(
                  new EpicManagedSpawnError(
                    [5, 740].includes(native)
                      ? "EACCES"
                      : native === 2
                        ? "ENOENT"
                        : "UNKNOWN"
                  )
                );
              } else if (
                code === null ||
                !(options.successExitCodes ?? [0]).includes(code)
              )
                reject(new EpicManagedError(classifyLegendaryFailure(stderr)));
              else resolve({ stdout, stderr });
            }, reject);
          });
          options.signal.addEventListener("abort", abort, { once: true });
          if (options.signal.aborted) abort();
          else {
            touch();
            if (options.timeout)
              timeout = setTimeout(
                () => interrupt(new EpicManagedError("timeout")),
                options.timeout
              );
          }
        }),
      { command: commandTiming(args), streaming: Boolean(options.streaming) }
    );
  } finally {
    if (jobDirectory)
      await withEpicTiming("process.windows.cleanup", () =>
        fs.rm(jobDirectory, { recursive: true, force: true })
      );
  }
}

interface ManagedRuntimeOptions {
  userData: string;
  binary: () => Promise<string>;
  session: Pick<EpicSessionProvider, "useBundle" | "useLocalIdentity"> &
    Partial<Pick<EpicSessionProvider, "accessSnapshot">>;
  managedCommand?: () => Promise<EpicManagedCommand>;
  supervisorDirectory?: string;
  current: (target: EpicManagedTarget) => boolean;
  execute?: typeof executeManagedLegendary;
}

export class LegendaryManagedRuntime {
  private readonly queues = new Map<string, Promise<unknown>>();
  private readonly active = new Map<AbortController, Promise<unknown>>();
  private readonly targeted: EpicTargetRuntime;
  constructor(private readonly options: ManagedRuntimeOptions) {
    this.targeted = new EpicTargetRuntime({
      userData: options.userData,
      command:
        options.managedCommand ??
        (async () => {
          throw new EpicManagedError("legendary-unavailable");
        }),
      session: options.session,
      execute: options.execute ?? executeManagedLegendary,
      supervisorDirectory: options.supervisorDirectory,
      current: (target) => this.current(target),
      workspace: (target) => this.workspace(target),
      serialize: (target, task, signal) =>
        this.serializeWorkspace(target, task, signal),
      active: this.active,
    });
  }
  inspect(
    target: EpicManagedTarget,
    objectId: string,
    signal: AbortSignal,
    cached?: { manifest?: unknown }
  ) {
    return this.targeted.inspect(target, objectId, signal, cached);
  }
  streamInstall(
    target: EpicManagedTarget,
    objectId: string,
    prepared: { manifest?: unknown },
    args: string[],
    options: { signal: AbortSignal; onLine: (line: string) => void }
  ) {
    return this.targeted.streamInstall(
      target,
      objectId,
      prepared,
      args,
      options
    );
  }
  refreshSession(
    auth: EpicManagedTarget["auth"],
    connection: EpicManagedTarget["connection"],
    bundle: EpicSessionBundle,
    signal: AbortSignal
  ) {
    return this.targeted.refresh(auth, connection, bundle, signal);
  }
  workspace(
    target: Pick<EpicManagedTarget, "owner" | "artifactId" | "platform">
  ) {
    return managedWorkspacePath(
      this.options.userData,
      target.owner,
      target.artifactId,
      target.platform
    );
  }
  current(target: EpicManagedTarget) {
    return this.options.current(target);
  }
  assertCurrent(target: EpicManagedTarget, signal?: AbortSignal) {
    if (signal?.aborted || !this.current(target))
      throw new EpicManagedError("operation-cancelled");
  }
  async serializeWorkspace<T>(
    target: EpicManagedTarget,
    task: (directory: string) => Promise<T>,
    signal?: AbortSignal
  ): Promise<T> {
    return this.serializeLocalWorkspace(
      target,
      async (directory) => {
        this.assertCurrent(target, signal);
        return task(directory);
      },
      signal
    );
  }
  /** Local metadata cleanup needs no Epic session and never executes the CLI. */
  async serializeLocalWorkspace<T>(
    target: Pick<EpicManagedTarget, "owner" | "artifactId" | "platform">,
    task: (directory: string) => Promise<T>,
    signal?: AbortSignal
  ): Promise<T> {
    const directory = this.workspace(target);
    const { queued, result } = queueEpicOperation(
      this.queues.get(directory),
      async () => {
        await withEpicTiming("runtime.workspace.prepare", () =>
          this.prepareDirectory(directory)
        );
        if (signal?.aborted) throw new EpicManagedError("operation-cancelled");
        return task(directory);
      },
      signal,
      { queue: "workspace" }
    );
    this.queues.set(directory, queued);
    void queued
      .finally(() => {
        if (this.queues.get(directory) === queued)
          this.queues.delete(directory);
      })
      .catch(() => undefined);
    return result;
  }
  private async prepareDirectory(directory: string) {
    const managedRoot = path.join(this.options.userData, "epic-managed");
    for (const item of [managedRoot, path.dirname(directory), directory]) {
      await fs.mkdir(item, { recursive: true, mode: 0o700 });
      const stat = await fs.lstat(item);
      if (!stat.isDirectory() || stat.isSymbolicLink())
        throw new EpicManagedError("invalid-path");
      await fs.chmod(item, 0o700);
    }
    const config = path.join(directory, "config.ini");
    try {
      const stat = await fs.lstat(config);
      if (!stat.isFile() || stat.isSymbolicLink())
        throw new EpicManagedError("invalid-path");
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
    await fs.writeFile(
      config,
      "[Legendary]\ndisable_update_check = true\ndisable_update_notice = true\ndisable_auto_aliasing = true\n",
      { mode: 0o600 }
    );
  }
  private async credentials(directory: string, bundle: EpicSessionBundle) {
    return withEpicTiming("runtime.credentials.write", async () => {
      for (const [name, value] of [
        ["user.json", validateLegendarySession(bundle.user)],
        ["version.json", validateLegendaryVersion(bundle.version)],
      ] as const) {
        const contents = JSON.stringify(value);
        if (Buffer.byteLength(contents) > EPIC_SESSION_MAX_FILE_BYTES)
          throw new EpicManagedError("invalid-response");
        await fs.rm(path.join(directory, name), { force: true });
        await fs.writeFile(path.join(directory, name), contents, {
          mode: 0o600,
          flag: "wx",
        });
      }
    });
  }
  private async saveSession(
    directory: string,
    target: EpicManagedTarget,
    save: (bundle: EpicSessionBundle) => Promise<void>
  ) {
    return withEpicTiming("runtime.session.save", async () => {
      const read = async (name: string) => {
        const file = path.join(directory, name);
        const stat = await fs.lstat(file);
        if (
          !stat.isFile() ||
          stat.isSymbolicLink() ||
          stat.size > EPIC_SESSION_MAX_FILE_BYTES
        )
          throw new EpicManagedError("invalid-response");
        return JSON.parse(await fs.readFile(file, "utf8"));
      };
      const user = validateLegendarySession(await read("user.json"));
      const version = validateLegendaryVersion(await read("version.json"));
      if (String(user.account_id).toLowerCase() !== target.owner.epicAccountId)
        throw new EpicManagedError("different-account");
      if (Date.parse(user.expires_at as string) > Date.now())
        await save({ user, version });
    });
  }
  private async clearCredentials(directory: string) {
    return withEpicTiming("runtime.credentials.cleanup", async () => {
      const results = await Promise.allSettled(
        ["user.json", "version.json", "managed-request.json"].map((name) =>
          fs.rm(path.join(directory, name), { force: true })
        )
      );
      if (results.some((result) => result.status === "rejected"))
        throw new EpicManagedError("cleanup-failed");
    });
  }
  runRaw(
    target: EpicManagedTarget,
    args: string[],
    options: { signal: AbortSignal; timeout?: number }
  ) {
    return withEpicTiming(
      "runtime.raw",
      () =>
        this.serializeWorkspace(
          target,
          () => this.runRawUnlocked(target, args, options),
          options.signal
        ),
      { command: commandTiming(args) }
    );
  }
  async runRawUnlocked(
    target: EpicManagedTarget,
    args: string[],
    options: { signal: AbortSignal; timeout?: number }
  ) {
    this.assertCurrent(target, options.signal);
    const controller = new AbortController();
    const abort = () => controller.abort();
    options.signal.addEventListener("abort", abort, { once: true });
    const operation = this.options.session.useBundle(
      target.auth,
      target.connection,
      controller.signal,
      async (bundle, save) => {
        const directory = this.workspace(target);
        try {
          await this.credentials(directory, bundle);
          this.assertCurrent(target, controller.signal);
          return await (this.options.execute ?? executeManagedLegendary)(
            await withEpicTiming("runtime.binary.resolve", () =>
              this.options.binary()
            ),
            [
              "--api-timeout",
              String(EPIC_LEGENDARY_API_TIMEOUT_SECONDS),
              ...args,
            ],
            directory,
            {
              signal: controller.signal,
              timeout: options.timeout ?? EPIC_SYNC_TIMEOUT_MS,
            }
          );
        } finally {
          try {
            await this.saveSession(directory, target, save);
          } finally {
            await this.clearCredentials(directory);
          }
        }
      }
    );
    this.active.set(controller, operation);
    try {
      const result = await operation;
      this.assertCurrent(target, options.signal);
      return result;
    } finally {
      options.signal.removeEventListener("abort", abort);
      this.active.delete(controller);
    }
  }
  async runJson(
    target: EpicManagedTarget,
    args: string[],
    options: { signal: AbortSignal; timeout?: number }
  ): Promise<unknown> {
    const result = await this.runRaw(target, args, options);
    try {
      return JSON.parse(result.stdout);
    } catch {
      throw new EpicManagedError("invalid-response");
    }
  }
  async runOfflineLaunch(
    target: EpicManagedTarget,
    options: { signal: AbortSignal }
  ): Promise<unknown> {
    if (target.localOnly !== true)
      throw new EpicManagedError("invalid-operation");
    return this.serializeWorkspace(
      target,
      async (directory) => {
        const controller = new AbortController();
        const abort = () => controller.abort();
        options.signal.addEventListener("abort", abort, { once: true });
        if (options.signal.aborted) controller.abort();
        const operation = this.options.session.useLocalIdentity(
          target.auth,
          target.connection,
          controller.signal,
          async (identity) => {
            try {
              await this.clearCredentials(directory);
              await fs.writeFile(
                path.join(directory, "user.json"),
                JSON.stringify(identity),
                { mode: 0o600, flag: "wx" }
              );
              this.assertCurrent(target, controller.signal);
              const result = await (
                this.options.execute ?? executeManagedLegendary
              )(
                await withEpicTiming("runtime.binary.resolve", () =>
                  this.options.binary()
                ),
                [
                  "--api-timeout",
                  String(EPIC_LEGENDARY_API_TIMEOUT_SECONDS),
                  "launch",
                  target.artifactId,
                  "--offline",
                  "--json",
                  "--no-wine",
                ],
                directory,
                { signal: controller.signal, timeout: EPIC_SYNC_TIMEOUT_MS }
              );
              this.assertCurrent(target, controller.signal);
              try {
                return JSON.parse(result.stdout);
              } catch {
                throw new EpicManagedError("invalid-response");
              }
            } finally {
              await this.clearCredentials(directory);
            }
          },
          () => this.current(target)
        );
        this.active.set(controller, operation);
        try {
          return await operation;
        } finally {
          options.signal.removeEventListener("abort", abort);
          this.active.delete(controller);
        }
      },
      options.signal
    );
  }
  async stream(
    target: EpicManagedTarget,
    args: string[],
    options: { signal: AbortSignal; onLine: (line: string) => void }
  ) {
    return this.serializeWorkspace(
      target,
      async (directory) => {
        const controller = new AbortController();
        const abort = () => controller.abort();
        options.signal.addEventListener("abort", abort, { once: true });
        if (options.signal.aborted) controller.abort();
        let processOperation: Promise<unknown> | undefined;
        const operation = this.options.session.useBundle(
          target.auth,
          target.connection,
          controller.signal,
          async (bundle, save) => {
            let prepared!: () => void;
            const boundary = new Promise<void>((done) => {
              prepared = done;
            });
            let hasBoundary = false;
            try {
              await this.credentials(directory, bundle);
              this.assertCurrent(target, controller.signal);
              processOperation = (
                this.options.execute ?? executeManagedLegendary
              )(
                await withEpicTiming("runtime.binary.resolve", () =>
                  this.options.binary()
                ),
                [
                  "--api-timeout",
                  String(EPIC_LEGENDARY_API_TIMEOUT_SECONDS),
                  ...args,
                ],
                directory,
                {
                  signal: controller.signal,
                  streaming: true,
                  onLine: (line) => {
                    if (
                      !hasBoundary &&
                      /\bDownload size(?::| is 0\b)/.test(line)
                    ) {
                      hasBoundary = true;
                      markEpicTiming("runtime.transfer.prepared");
                      prepared();
                    }
                    options.onLine(line);
                  },
                }
              );
              // The token lease ends after preparation, not after hours of transfer.
              await Promise.race([boundary, processOperation]);
              await this.saveSession(directory, target, save);
            } catch (error) {
              controller.abort();
              await processOperation?.catch(() => undefined);
              // On preparation failures a refresh may already have rotated credentials.
              await this.saveSession(directory, target, save);
              throw error;
            } finally {
              await this.clearCredentials(directory);
            }
          }
        );
        const all = operation.then(() => processOperation);
        this.active.set(controller, all);
        try {
          await all;
          this.assertCurrent(target, options.signal);
        } finally {
          options.signal.removeEventListener("abort", abort);
          this.active.delete(controller);
          await this.clearCredentials(directory);
        }
      },
      options.signal
    );
  }
  async stop() {
    for (const controller of this.active.keys()) controller.abort();
    const results = await Promise.allSettled(this.active.values());
    if (
      results.some(
        (item) =>
          item.status === "rejected" && item.reason?.code === "cleanup-failed"
      )
    )
      throw new EpicManagedError("cleanup-failed");
  }
  async cleanupCredentials() {
    for (const name of ["epic-managed", "epic-managed-previews"]) {
      const root = path.join(this.options.userData, name);
      let scopes;
      try {
        const stat = await fs.lstat(root);
        if (!stat.isDirectory() || stat.isSymbolicLink())
          throw new EpicManagedError("invalid-path");
        scopes = await fs.readdir(root, { withFileTypes: true });
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === "ENOENT") continue;
        throw error;
      }
      for (const scope of scopes) {
        if (!scope.isDirectory() || !/^[a-f0-9]{64}$/.test(scope.name))
          continue;
        const scopeRoot = path.join(root, scope.name);
        const scopeStat = await fs.lstat(scopeRoot);
        if (!scopeStat.isDirectory() || scopeStat.isSymbolicLink())
          throw new EpicManagedError("invalid-path");
        for (const game of await fs.readdir(scopeRoot, {
          withFileTypes: true,
        })) {
          if (game.isDirectory() && /^[a-f0-9]{64}$/.test(game.name)) {
            const directory = path.join(scopeRoot, game.name);
            const stat = await fs.lstat(directory);
            if (!stat.isDirectory() || stat.isSymbolicLink())
              throw new EpicManagedError("invalid-path");
            await this.clearCredentials(directory);
          }
        }
      }
    }
  }
}
