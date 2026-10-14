import fs from "node:fs/promises";
import path from "node:path";
import { isPathInside } from "./session-attribution.js";

export interface EpicProcessNode {
  pid: number;
  parentPid?: number | null;
  exe: string | null;
}
/** Captured PID ancestry is evidence; a filename or any executable in the folder is not. */
export class EpicManagedProcessTracker {
  private readonly observed = new Map<number, string>();
  constructor(
    private readonly rootPid: number,
    private readonly installPath: string
  ) {}
  async scan(
    processes: EpicProcessNode[]
  ): Promise<{ complete: boolean; paths: string[] }> {
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
}
