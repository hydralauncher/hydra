import path from "node:path";

import type { ProcessPayload } from "./download/types";

const normalizeWindowsExecutable = (value: string) =>
  path.win32.normalize(value).toLowerCase();

export const matchesWindowsExecutable = (
  executable: string | null,
  targets: string[]
) => {
  if (!executable) return false;
  const normalizedExecutable = normalizeWindowsExecutable(executable);
  return targets.some(
    (target) => normalizeWindowsExecutable(target) === normalizedExecutable
  );
};

export const expandProcessTree = (
  processes: ProcessPayload[],
  rootPids: Iterable<number>,
  excludedPid = process.pid
) => {
  const selected = new Set(
    Array.from(rootPids).filter((pid) => pid > 0 && pid !== excludedPid)
  );
  let addedChild = true;

  while (addedChild) {
    addedChild = false;
    for (const candidate of processes) {
      if (
        candidate.pid === excludedPid ||
        selected.has(candidate.pid) ||
        !candidate.parentPid ||
        !selected.has(candidate.parentPid)
      ) {
        continue;
      }
      selected.add(candidate.pid);
      addedChild = true;
    }
  }

  return Array.from(selected).reverse();
};
