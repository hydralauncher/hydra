import fs from "node:fs/promises";
import path from "node:path";
import { isPathInside } from "./session-attribution.js";

export interface EpicProcessNode {
  pid: number;
  parentPid?: number | null;
  exe: string | null;
  /** Linux kernel start ticks, kept as text to avoid loss of integer precision. */
  startTime?: string | null;
  invocationId?: string | null;
  winePrefixPath?: string | null;
  peExecutablePath?: string | null;
  inspectionComplete?: boolean;
  cwd?: string | null;
}

export interface EpicLinuxProcessContext {
  invocationId: string;
  winePrefixPath: string;
  rootStartTime?: string | null;
}

const infrastructurePeNames = new Set([
  "services.exe",
  "winedevice.exe",
  "plugplay.exe",
  "rpcss.exe",
  "svchost.exe",
  "explorer.exe",
  "conhost.exe",
]);
const overlayPeNames = new Set([
  "eosoverlayrenderer-win64-shipping.exe",
  "eosoverlayrenderer-win32-shipping.exe",
  "gameoverlayui.exe",
]);

const linuxPathEquals = (left: string, right: string) =>
  path.normalize(left) === path.normalize(right);

/** Captured PID ancestry is evidence; a filename or any executable in the folder is not. */
export class EpicManagedProcessTracker {
  private readonly observed = new Map<number, string>();
  private readonly linuxObserved = new Map<number, string>();
  constructor(
    private readonly rootPid: number,
    private readonly installPath: string,
    private readonly linuxContext?: EpicLinuxProcessContext
  ) {}
  async scan(
    processes: EpicProcessNode[]
  ): Promise<{ complete: boolean; paths: string[] }> {
    if (this.linuxContext) return this.scanLinux(processes);
    const byPid = new Map(processes.map((entry) => [entry.pid, entry]));
    const descendant = (process: EpicProcessNode) => {
      const visited = new Set<number>();
      let current: EpicProcessNode | undefined = process;
      while (current && !visited.has(current.pid)) {
        visited.add(current.pid);
        if (current.pid === this.rootPid || this.observed.has(current.pid))
          return true;
        if (!current.parentPid) return false;
        if (
          current.parentPid === this.rootPid ||
          this.observed.has(current.parentPid)
        )
          return true;
        current = byPid.get(current.parentPid);
      }
      return false;
    };
    let complete = true;
    const paths: string[] = [];
    if (
      processes.some(
        (entry) =>
          entry.parentPid == null &&
          entry.pid !== this.rootPid &&
          !this.observed.has(entry.pid) &&
          entry.exe &&
          isPathInside(this.installPath, entry.exe)
      )
    )
      complete = false;
    for (const process of processes.filter(descendant)) {
      if (!process.exe || !path.isAbsolute(process.exe)) {
        complete = false;
        continue;
      }
      let executable: string;
      try {
        executable = await fs.realpath(process.exe);
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "ENOENT")
          complete = false;
        continue;
      }
      const observed = this.observed.get(process.pid);
      if (observed && path.relative(observed, executable) !== "") continue;
      // Retain proven intermediary ancestry even when a wrapper lives outside
      // the installation; it may spawn the real executable after its parent exits.
      this.observed.set(process.pid, executable);
      if (
        !isPathInside(this.installPath, process.exe) ||
        !isPathInside(this.installPath, executable)
      ) {
        complete = false;
        continue;
      }
      paths.push(executable);
    }
    return {
      complete,
      paths: [...new Set(paths)].sort((left, right) =>
        left.localeCompare(right, "en")
      ),
    };
  }

  private async scanLinux(processes: EpicProcessNode[]) {
    const context = this.linuxContext!;
    const byPid = new Map(processes.map((entry) => [entry.pid, entry]));
    const isKnownNonWriter = (canonical: string) => {
      const name = path.basename(canonical).toLowerCase();
      return (
        (infrastructurePeNames.has(name) &&
          isPathInside(
            path.join(context.winePrefixPath, "drive_c", "windows"),
            canonical
          )) ||
        (overlayPeNames.has(name) &&
          isPathInside(context.winePrefixPath, canonical))
      );
    };
    const identityMatches = (entry: EpicProcessNode) =>
      Boolean(
        entry.startTime &&
          (this.linuxObserved.get(entry.pid) === entry.startTime ||
            (entry.pid === this.rootPid &&
              context.rootStartTime === entry.startTime))
      );
    const hasCapturedAncestor = (entry: EpicProcessNode) => {
      const visited = new Set<number>();
      let current: EpicProcessNode | undefined = entry;
      while (current && !visited.has(current.pid)) {
        visited.add(current.pid);
        if (
          (current.invocationId &&
            current.invocationId !== context.invocationId) ||
          (current.winePrefixPath &&
            !linuxPathEquals(current.winePrefixPath, context.winePrefixPath))
        )
          return false;
        if (identityMatches(current)) return true;
        current = current.parentPid ? byPid.get(current.parentPid) : undefined;
      }
      return false;
    };
    let complete = true;
    const paths = new Set<string>();
    // Establish token/identity evidence first, independent of enumeration order.
    for (const entry of processes) {
      if (
        entry.startTime &&
        entry.invocationId === context.invocationId &&
        entry.winePrefixPath &&
        linuxPathEquals(entry.winePrefixPath, context.winePrefixPath)
      ) {
        this.linuxObserved.set(entry.pid, entry.startTime);
      }
    }
    for (const entry of processes) {
      // An explicit foreign token/prefix cannot become ours through a reused PID.
      if (
        (entry.invocationId && entry.invocationId !== context.invocationId) ||
        (entry.winePrefixPath &&
          !linuxPathEquals(entry.winePrefixPath, context.winePrefixPath))
      )
        continue;
      const attributed =
        entry.invocationId === context.invocationId ||
        hasCapturedAncestor(entry);
      const samePrefix =
        !entry.invocationId &&
        entry.winePrefixPath &&
        linuxPathEquals(entry.winePrefixPath, context.winePrefixPath);
      if (!attributed) {
        // A detached helper may lose its token before our first snapshot. The
        // prefix alone cannot prove ownership or playtime, but an unknown PE
        // in that prefix also cannot prove that all save writers have closed.
        if (samePrefix) {
          if (entry.inspectionComplete !== true) complete = false;
          else if (entry.peExecutablePath) {
            const canonical = await fs
              .realpath(entry.peExecutablePath)
              .catch(() => null);
            if (!canonical || !isKnownNonWriter(canonical)) complete = false;
          }
        }
        continue;
      }
      if (
        !entry.startTime ||
        entry.inspectionComplete !== true ||
        !entry.winePrefixPath
      ) {
        complete = false;
        continue;
      }
      this.linuxObserved.set(entry.pid, entry.startTime);
      const pePath = entry.peExecutablePath;
      // Python, runtime wrappers and native overlays are not Windows writers.
      if (!pePath) continue;
      let canonical: string;
      try {
        canonical = await fs.realpath(pePath);
      } catch {
        complete = false;
        continue;
      }
      if (
        !isPathInside(this.installPath, pePath) ||
        !isPathInside(this.installPath, canonical)
      ) {
        // Known Wine infrastructure/overlays can outlive the actual game.
        if (!isKnownNonWriter(canonical)) complete = false;
        continue;
      }
      paths.add(canonical);
    }
    // Keep identities for live wrappers so a later child can inherit evidence,
    // but never retain absent PIDs as potential parents of a future process.
    for (const [pid, startTime] of this.linuxObserved) {
      if (byPid.get(pid)?.startTime !== startTime)
        this.linuxObserved.delete(pid);
    }
    return {
      complete,
      paths: [...paths].sort((left, right) => left.localeCompare(right, "en")),
    };
  }
}
