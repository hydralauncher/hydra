import { randomUUID } from "node:crypto";
import { spawn, type ChildProcess } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import { StringDecoder } from "node:string_decoder";
import {
  EPIC_LINUX_INVOCATION_ENV,
  EPIC_LINUX_MAX_LINE_BYTES,
  EPIC_LINUX_MAX_OUTPUT_BYTES,
  EPIC_LINUX_PROCESS_POLL_MS,
  EPIC_LINUX_PROCESS_SNAPSHOT_ATTEMPTS,
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

type ProcessFilesystem = Pick<
  typeof fs,
  "readdir" | "stat" | "readFile" | "realpath"
>;
interface ProcessSnapshot {
  pid: number;
  identity?: ProcessIdentity;
  environment?: string[];
  complete: boolean;
}
const processGone = (error: unknown) =>
  ["ENOENT", "ESRCH"].includes((error as NodeJS.ErrnoException).code ?? "");

async function readProcessSnapshot(
  pid: number,
  filesystem: ProcessFilesystem
): Promise<ProcessSnapshot | null> {
  // Retry a reused PID once rather than attaching an old environment to its
  // replacement. Persistent churn provides no token or prefix evidence.
  for (
    let attempt = 0;
    attempt < EPIC_LINUX_PROCESS_SNAPSHOT_ATTEMPTS;
    attempt++
  ) {
    let identity: ProcessIdentity | undefined;
    let environment: string[] | undefined;
    try {
      const directory = `/proc/${pid}`;
      const info = await filesystem.stat(directory);
      if (process.getuid && info.uid !== process.getuid()) return null;
      identity = parseLinuxProcessIdentity(
        pid,
        await filesystem.readFile(`${directory}/stat`, "utf8")
      );
      if (identity.state === "Z") return null;
      try {
        environment = (await filesystem.readFile(`${directory}/environ`))
          .toString()
          .split("\0");
      } catch (error) {
        if (processGone(error)) return null;
      }
      const after = parseLinuxProcessIdentity(
        pid,
        await filesystem.readFile(`${directory}/stat`, "utf8")
      );
      if (identity.startTime !== after.startTime) {
        if (attempt === 0) continue;
        return { pid, identity: after, complete: false };
      }
      return { pid, identity: after, environment, complete: !!environment };
    } catch (error) {
      if (processGone(error)) return null;
      // Partial observations matter only after attribution. A protected desktop
      // daemon belonging to this UID is not evidence about any Wine prefix.
      return { pid, identity, environment, complete: false };
    }
  }
  return null;
}

async function processSnapshots(filesystem: ProcessFilesystem) {
  // Dirent conversion can lstat an already vanished PID and reject the entire
  // enumeration. Names suffice; disappearing processes are handled per PID.
  const entries = await filesystem.readdir("/proc");
  const snapshots = await Promise.all(
    entries
      .filter((entry) => /^\d+$/.test(entry))
      .map((entry) => readProcessSnapshot(Number(entry), filesystem))
  );
  return snapshots.filter((entry): entry is ProcessSnapshot => entry !== null);
}

/** Observe only process identities and our noncredential invocation marker. */
export async function inspectLinuxInvocationProcesses(
  invocationId: string,
  known: Map<number, string>,
  filesystem: ProcessFilesystem = fs
): Promise<ProcessIdentity[]> {
  const snapshots = await processSnapshots(filesystem);
  const candidates: ProcessSnapshot[] = [];
  const tagged = new Set<number>();
  for (const snapshot of snapshots) {
    if (!snapshot.identity) {
      if (known.has(snapshot.pid)) throw failure("cleanup-failed");
      continue;
    }
    if (
      known.has(snapshot.pid) &&
      known.get(snapshot.pid) !== snapshot.identity.startTime
    )
      known.delete(snapshot.pid);
    candidates.push(snapshot);
    if (
      snapshot.environment?.includes(
        `${EPIC_LINUX_INVOCATION_ENV}=${invocationId}`
      )
    )
      tagged.add(snapshot.pid);
  }
  const selected = new Map<number, ProcessSnapshot>();
  for (const candidate of candidates) {
    if (
      tagged.has(candidate.pid) ||
      known.get(candidate.pid) === candidate.identity!.startTime
    )
      selected.set(candidate.pid, candidate);
  }
  let changed = true;
  while (changed) {
    changed = false;
    for (const candidate of candidates) {
      if (
        !selected.has(candidate.pid) &&
        selected.has(candidate.identity!.parentPid)
      ) {
        selected.set(candidate.pid, candidate);
        changed = true;
      }
    }
  }
  // Record descendants before reporting an incomplete snapshot: a child can
  // become reparented before the next scan, including during privileged exec.
  for (const candidate of selected.values())
    known.set(candidate.pid, candidate.identity!.startTime);
  if ([...selected.values()].some((candidate) => !candidate.complete))
    throw failure("cleanup-failed");
  return [...selected.values()].map((candidate) => candidate.identity!);
}

const observedPrefixes = new Map<string, Map<number, string>>();
export async function hasLinuxPrefixProcesses(prefix: string) {
  if (process.platform !== "linux") return false;
  const canonical = await fs
    .realpath(prefix)
    .catch(() => path.posix.resolve(prefix));
  const known = observedPrefixes.get(canonical) ?? new Map<number, string>();
  observedPrefixes.set(canonical, known);
  try {
    return await inspectLinuxPrefixProcesses(canonical, fs, known);
  } finally {
    if (!known.size && observedPrefixes.get(canonical) === known)
      observedPrefixes.delete(canonical);
  }
}

export async function inspectLinuxPrefixProcesses(
  prefix: string,
  filesystem: ProcessFilesystem = fs,
  known = new Map<number, string>()
) {
  const canonical = await filesystem
    .realpath(prefix)
    .catch(() => path.posix.resolve(prefix));
  const snapshots = await processSnapshots(filesystem);
  const byPid = new Map(snapshots.map((snapshot) => [snapshot.pid, snapshot]));
  for (const [pid, startTime] of known) {
    const snapshot = byPid.get(pid);
    if (
      !snapshot ||
      (snapshot.identity && snapshot.identity.startTime !== startTime)
    )
      known.delete(pid);
  }
  const results = await Promise.all(
    snapshots.map(async (snapshot) => {
      if (known.has(snapshot.pid)) return true;
      if (!snapshot.environment) return false;
      for (const variable of snapshot.environment) {
        const match = /^(WINEPREFIX|STEAM_COMPAT_DATA_PATH)=(.+)$/.exec(
          variable
        );
        if (!match || !path.posix.isAbsolute(match[2])) continue;
        const configured = match[2];
        const paths =
          match[1] === "STEAM_COMPAT_DATA_PATH"
            ? [configured, path.posix.join(configured, "pfx")]
            : [configured];
        for (const possible of paths) {
          let matches = path.posix.normalize(possible) === canonical;
          if (!matches) {
            try {
              matches = (await filesystem.realpath(possible)) === canonical;
            } catch {
              // An inaccessible foreign path cannot occupy every prefix.
            }
          }
          if (matches) {
            if (snapshot.identity)
              known.set(snapshot.pid, snapshot.identity.startTime);
            return true;
          }
        }
      }
      return false;
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
        const closedBeforeSnapshot = wrapperClosed;
        const alive = await inspectLinuxInvocationProcesses(
          invocationId,
          known
        );
        if (!alive.length && closedBeforeSnapshot && wrapperClosed) return;
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
    if (terminatePromise !== undefined) await terminatePromise;
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
      void inspectLinuxInvocationProcesses(invocationId, known)
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
        if (terminatePromise !== undefined) await terminatePromise;
        if (outputFailure) throw outputFailure;
        if (options.signal?.aborted) throw failure("operation-cancelled");
        const closedBeforeSnapshot = wrapperClosed;
        let alive: ProcessIdentity[];
        try {
          alive =
            process.platform === "linux"
              ? await inspectLinuxInvocationProcesses(invocationId, known)
              : [];
        } catch (error) {
          // Privileged exec transitions can briefly protect /proc. An unknown
          // observation remains busy and is retried until the tool deadline.
          // It must never turn into successful closure or force a success path.
          if ((error as { code?: string }).code !== "cleanup-failed")
            throw error;
          await pause(EPIC_LINUX_PROCESS_POLL_MS);
          continue;
        }
        if (closedBeforeSnapshot && wrapperClosed && !alive.length) {
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
