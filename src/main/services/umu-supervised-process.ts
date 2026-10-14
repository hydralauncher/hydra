import { randomUUID } from "node:crypto";
import { spawn, type ChildProcess } from "node:child_process";
import fs from "node:fs/promises";
import { StringDecoder } from "node:string_decoder";
import { isVerifiedLinuxUserService } from "./linux-user-service-proof.js";
import {
  EPIC_LINUX_INVOCATION_ENV,
  EPIC_LINUX_MAX_LINE_BYTES,
  EPIC_LINUX_MAX_OUTPUT_BYTES,
  EPIC_LINUX_PROCESS_POLL_MS,
  EPIC_LINUX_TERMINATE_GRACE_MS,
  EPIC_LINUX_TERMINATE_TIMEOUT_MS,
} from "./epic/linux-runtime-constants.js";

export interface UmuProcessHandle {
  pid: number;
  invocationId: string;
  rootStartTime?: string;
  exited: Promise<{ code: number | null; signal: NodeJS.Signals | null }>;
  output: Promise<{ stdout: string; stderr: string }>;
  /** Resolves only after natural wrapper and attributed descendant exit. */
  waitForTreeExit(): Promise<void>;
  terminate(): Promise<void>;
}

export interface SupervisedUmuOptions {
  executable: string;
  args: string[];
  cwd: string;
  environment: NodeJS.ProcessEnv;
  signal?: AbortSignal;
  timeoutMs?: number;
  /** Only unauthenticated bootstrap/path requests may capture output. */
  captureOutput?: boolean;
  onLine?: (line: string) => void;
  spawnProcess?: typeof spawn;
}

interface ProcessIdentity {
  pid: number;
  parentPid: number;
  startTime: string;
  state: string;
}

export function parseLinuxProcessIdentity(
  pid: number,
  stat: string
): ProcessIdentity {
  const end = stat.lastIndexOf(")");
  const fields = stat
    .slice(end + 2)
    .trim()
    .split(/\s+/);
  if (end < 0 || fields.length < 20 || !/^\d+$/.test(fields[19]))
    throw new Error("invalid-response");
  return {
    pid,
    state: fields[0],
    parentPid: Number(fields[1]),
    startTime: fields[19],
  };
}

const failure = (code: string) => Object.assign(new Error(code), { code });
const pause = (duration: number) =>
  new Promise<void>((done) => setTimeout(done, duration));

/** Observe only process identities and our noncredential invocation marker. */
async function invocationProcesses(
  invocationId: string,
  known: Map<number, string>
): Promise<ProcessIdentity[]> {
  const entries = await fs.readdir("/proc", { withFileTypes: true });
  const candidates: ProcessIdentity[] = [];
  const tagged = new Set<number>();
  await Promise.all(
    entries
      .filter((entry) => /^\d+$/.test(entry.name))
      .map(async (entry) => {
        const pid = Number(entry.name);
        let ownProcess = false;
        try {
          const directory = `/proc/${pid}`;
          const info = await fs.stat(directory);
          if (process.getuid && info.uid !== process.getuid()) return;
          ownProcess = true;
          const identity = parseLinuxProcessIdentity(
            pid,
            await fs.readFile(`${directory}/stat`, "utf8")
          );
          if (identity.state === "Z") return;
          candidates.push(identity);
          try {
            const env = await fs.readFile(`${directory}/environ`);
            if (
              env
                .toString()
                .split("\0")
                .includes(`${EPIC_LINUX_INVOCATION_ENV}=${invocationId}`)
            )
              tagged.add(pid);
          } catch (error) {
            if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
          }
        } catch (error) {
          if (
            !["ENOENT", "ESRCH", "EACCES", "EPERM"].includes(
              (error as NodeJS.ErrnoException).code ?? ""
            )
          )
            throw error;
          // An inaccessible previously attributed process cannot be proved closed.
          if (
            (ownProcess || known.has(pid)) &&
            ["EACCES", "EPERM"].includes(
              (error as NodeJS.ErrnoException).code ?? ""
            )
          ) {
            if (!known.has(pid) && (await isVerifiedLinuxUserService(pid)))
              return;
            throw failure("cleanup-failed");
          }
        }
      })
  );
  const selected = new Map<number, ProcessIdentity>();
  for (const candidate of candidates) {
    if (
      tagged.has(candidate.pid) ||
      known.get(candidate.pid) === candidate.startTime
    )
      selected.set(candidate.pid, candidate);
  }
  let changed = true;
  while (changed) {
    changed = false;
    for (const candidate of candidates) {
      if (!selected.has(candidate.pid) && selected.has(candidate.parentPid)) {
        selected.set(candidate.pid, candidate);
        changed = true;
      }
    }
  }
  for (const candidate of selected.values())
    known.set(candidate.pid, candidate.startTime);
  return [...selected.values()];
}

export async function hasLinuxPrefixProcesses(prefix: string) {
  if (process.platform !== "linux") return false;
  return inspectLinuxPrefixProcesses(prefix);
}

export async function inspectLinuxPrefixProcesses(
  prefix: string,
  filesystem: Pick<typeof fs, "readdir" | "stat" | "readFile" | "realpath"> = fs
) {
  const entries = await filesystem.readdir("/proc", { withFileTypes: true });
  const results = await Promise.all(
    entries
      .filter((entry) => /^\d+$/.test(entry.name))
      .map(async (entry) => {
        try {
          const directory = `/proc/${entry.name}`;
          const info = await filesystem.stat(directory);
          if (process.getuid && info.uid !== process.getuid()) return false;
          // After proving same UID, inability to inspect a live process is an
          // unknown result, never evidence that the prefix is idle.
          try {
            const before = parseLinuxProcessIdentity(
              Number(entry.name),
              await filesystem.readFile(`${directory}/stat`, "utf8")
            );
            if (before.state === "Z") return false;
            const environment = (
              await filesystem.readFile(`${directory}/environ`)
            )
              .toString()
              .split("\0");
            const after = parseLinuxProcessIdentity(
              Number(entry.name),
              await filesystem.readFile(`${directory}/stat`, "utf8")
            );
            if (before.startTime !== after.startTime) return true;
            const configured = environment
              .filter((value) =>
                /^(?:WINEPREFIX|STEAM_COMPAT_DATA_PATH)=/.test(value)
              )
              .map((value) => value.slice(value.indexOf("=") + 1));
            for (const candidate of configured) {
              for (const possible of [candidate, `${candidate}/pfx`]) {
                try {
                  if ((await filesystem.realpath(possible)) === prefix)
                    return true;
                } catch (error) {
                  if (
                    !["ENOENT", "ENOTDIR"].includes(
                      (error as NodeJS.ErrnoException).code ?? ""
                    )
                  )
                    return true;
                }
              }
            }
            return false;
          } catch (error) {
            if (
              ["EACCES", "EPERM"].includes(
                (error as NodeJS.ErrnoException).code ?? ""
              ) &&
              (await isVerifiedLinuxUserService(Number(entry.name), filesystem))
            )
              return false;
            return !["ENOENT", "ESRCH"].includes(
              (error as NodeJS.ErrnoException).code ?? ""
            );
          }
        } catch (error) {
          if (
            ["ENOENT", "ESRCH", "EACCES", "EPERM"].includes(
              (error as NodeJS.ErrnoException).code ?? ""
            )
          )
            return false;
          throw failure("cleanup-failed");
        }
      })
  );
  return results.some(Boolean);
}

/** Never logs argv, raw output, environment, or native spawn errors. */
export async function spawnSupervisedUmu(
  options: SupervisedUmuOptions
): Promise<UmuProcessHandle> {
  if (options.signal?.aborted) throw failure("operation-cancelled");
  const invocationId = randomUUID();
  const known = new Map<number, string>();
  let child: ChildProcess;
  try {
    child = (options.spawnProcess ?? spawn)(options.executable, options.args, {
      cwd: options.cwd,
      env: {
        ...options.environment,
        [EPIC_LINUX_INVOCATION_ENV]: invocationId,
      },
      detached: true,
      shell: false,
      stdio: ["ignore", "pipe", "pipe"],
    });
  } catch {
    throw failure("compatibility-launch-failed");
  }
  let wrapperClosed = false;
  let stdout = "";
  let stderr = "";
  let bytes = 0;
  let outputFailure: unknown;
  let terminatePromise: Promise<void> | undefined;
  let timeout: ReturnType<typeof setTimeout> | undefined;
  let scanner: ReturnType<typeof setInterval> | undefined;
  let treeExit: Promise<void> | undefined;
  const clearLifecycle = () => {
    clearTimeout(timeout);
    clearInterval(scanner);
    options.signal?.removeEventListener("abort", abort);
  };
  const pending = { stdout: "", stderr: "" };
  const decoders = {
    stdout: new StringDecoder("utf8"),
    stderr: new StringDecoder("utf8"),
  };
  const terminate = () => {
    terminatePromise ??= (async () => {
      if (process.platform !== "linux") {
        if (!wrapperClosed) child.kill("SIGKILL");
        await exited;
        return;
      }
      const deadline = Date.now() + EPIC_LINUX_TERMINATE_TIMEOUT_MS;
      const forceAt = Date.now() + EPIC_LINUX_TERMINATE_GRACE_MS;
      for (;;) {
        const alive = await invocationProcesses(invocationId, known);
        if (!alive.length && wrapperClosed) return;
        const signal = Date.now() >= forceAt ? "SIGKILL" : "SIGTERM";
        for (const identity of alive) {
          try {
            const current = parseLinuxProcessIdentity(
              identity.pid,
              await fs.readFile(`/proc/${identity.pid}/stat`, "utf8")
            );
            if (current.startTime === identity.startTime)
              process.kill(identity.pid, signal);
          } catch (error) {
            if (
              !["ENOENT", "ESRCH"].includes(
                (error as NodeJS.ErrnoException).code ?? ""
              )
            )
              throw failure("cleanup-failed");
          }
        }
        // A vanished root PID may already have been reused while descendants
        // retain its pipes. Never signal that numeric PID without identity.
        if (Date.now() >= deadline) throw failure("cleanup-failed");
        await pause(EPIC_LINUX_PROCESS_POLL_MS);
      }
    })().then(clearLifecycle, (error) => {
      terminatePromise = undefined;
      throw error;
    });
    return terminatePromise;
  };
  const abort = () => {
    void terminate().catch(() => undefined);
  };
  const collect = (chunk: Buffer, stream: "stdout" | "stderr") => {
    // Output from authenticated games is drained, never retained or emitted.
    if (!options.captureOutput) return;
    bytes += chunk.length;
    if (bytes > EPIC_LINUX_MAX_OUTPUT_BYTES) {
      outputFailure ??= failure("invalid-response");
      abort();
      return;
    }
    const text = decoders[stream].write(chunk);
    if (stream === "stdout") stdout += text;
    else stderr += text;
    const lines = (pending[stream] + text).split(/[\r\n]/);
    pending[stream] = lines.pop() ?? "";
    if (Buffer.byteLength(pending[stream]) > EPIC_LINUX_MAX_LINE_BYTES) {
      outputFailure ??= failure("invalid-response");
      abort();
      return;
    }
    try {
      for (const line of lines) options.onLine?.(line);
    } catch {
      outputFailure ??= failure("invalid-response");
      abort();
    }
  };
  child.stdout?.on("data", (chunk: Buffer) => collect(chunk, "stdout"));
  child.stderr?.on("data", (chunk: Buffer) => collect(chunk, "stderr"));
  const exited = new Promise<{
    code: number | null;
    signal: NodeJS.Signals | null;
  }>((resolve) => {
    child.once("close", (code, signal) => {
      wrapperClosed = true;
      resolve({ code, signal });
    });
  });
  const output = exited.then(async () => {
    if (terminatePromise) await terminatePromise;
    if (outputFailure) throw outputFailure;
    if (options.captureOutput) {
      for (const stream of ["stdout", "stderr"] as const) {
        const tail = decoders[stream].end();
        if (stream === "stdout") stdout += tail;
        else stderr += tail;
        if (pending[stream] || tail) options.onLine?.(pending[stream] + tail);
      }
    }
    return { stdout, stderr };
  });
  // The caller may only need the process handle; avoid unhandled rejections.
  void output.catch(() => undefined);
  const pid = await new Promise<number>((resolve, reject) => {
    child.once("spawn", () =>
      child.pid
        ? resolve(child.pid)
        : reject(failure("compatibility-launch-failed"))
    );
    child.once("error", () => reject(failure("compatibility-launch-failed")));
  });
  let rootStartTime: string | undefined;
  if (process.platform === "linux") {
    try {
      rootStartTime = parseLinuxProcessIdentity(
        pid,
        await fs.readFile(`/proc/${pid}/stat`, "utf8")
      ).startTime;
      known.set(pid, rootStartTime);
    } catch {
      /* A short process may have completed before the first snapshot. */
    }
    let scanning = false;
    scanner = setInterval(() => {
      if (scanning) return;
      scanning = true;
      void invocationProcesses(invocationId, known)
        .then((alive) => {
          if (wrapperClosed && !alive.length) clearInterval(scanner);
        })
        .catch(() => undefined)
        .finally(() => {
          scanning = false;
        });
    }, EPIC_LINUX_PROCESS_POLL_MS);
    scanner.unref();
  }
  options.signal?.addEventListener("abort", abort, { once: true });
  if (options.signal?.aborted) abort();
  if (options.timeoutMs)
    timeout = setTimeout(() => {
      outputFailure ??= failure("timeout");
      abort();
    }, options.timeoutMs);
  const waitForTreeExit = () => {
    treeExit ??= (async () => {
      for (;;) {
        if (terminatePromise) await terminatePromise;
        if (outputFailure) throw outputFailure;
        if (options.signal?.aborted) throw failure("operation-cancelled");
        const alive =
          process.platform === "linux"
            ? await invocationProcesses(invocationId, known)
            : [];
        if (wrapperClosed && !alive.length) {
          clearLifecycle();
          return;
        }
        await pause(EPIC_LINUX_PROCESS_POLL_MS);
      }
    })();
    return treeExit;
  };
  // Keep timeout/cancellation supervision active after the wrapper exits.
  void waitForTreeExit().catch(() => undefined);
  return {
    pid,
    invocationId,
    rootStartTime,
    exited,
    output,
    waitForTreeExit,
    terminate,
  };
}
