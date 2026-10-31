import type { GameShop } from "@types";

import { isLinuxGameWindowProcess } from "../linux-process-match.js";
import { isWindowsGameForegroundProcess } from "../windows-game-window-match.js";

export interface ScreenshotGameTarget {
  gameKey: string;
  shop: GameShop;
  objectId: string;
  title: string;
  processId?: number;
  executablePaths: string[];
  winePrefixPath?: string | null;
  isEmulator: boolean;
}

export interface ForegroundWindowInfo {
  processId: number | null;
  windowHandle?: string;
  windowId?: string;
  clientProcessId?: number | null;
  focusSource?: string;
}

export interface ForegroundProcess {
  pid: number;
  parentPid?: number | null;
  exe?: string | null;
  cwd?: string | null;
  environ?: Record<string, string> | null;
  appImagePath?: string | null;
}

export interface ForegroundGameMatchInput {
  platform: NodeJS.Platform;
  targets: ScreenshotGameTarget[];
  foreground: ForegroundWindowInfo;
  processes: ForegroundProcess[];
  getNamespacedPids?: (hostPid: number) => number[] | null;
}

const collectDescendants = (
  processes: ForegroundProcess[],
  rootPid: number
) => {
  const childrenByParent = new Map<number, number[]>();
  for (const process of processes) {
    if (process.parentPid == null) continue;
    const siblings = childrenByParent.get(process.parentPid) ?? [];
    siblings.push(process.pid);
    childrenByParent.set(process.parentPid, siblings);
  }

  const descendants = new Set<number>([rootPid]);
  const queue = [rootPid];
  while (queue.length) {
    const current = queue.shift()!;
    for (const child of childrenByParent.get(current) ?? []) {
      if (descendants.has(child)) continue;
      descendants.add(child);
      queue.push(child);
    }
  }

  return descendants;
};

const getInnermostNamespacedPid = (namespacedPids: number[] | null) =>
  namespacedPids && namespacedPids.length > 1 ? namespacedPids.at(-1) : null;

export const matchesSandboxedWindowProcess = (
  processes: ForegroundProcess[],
  windowProcessId: number,
  launchedProcessId: number | undefined,
  getNamespacedPids: (hostPid: number) => number[] | null
) => {
  if (launchedProcessId === undefined) return false;

  const descendants = collectDescendants(processes, launchedProcessId);
  const owners = processes.filter(
    (process) =>
      getInnermostNamespacedPid(getNamespacedPids(process.pid)) ===
      windowProcessId
  );

  return owners.length === 1 && descendants.has(owners[0].pid);
};

const matchesWindowsTarget = (
  input: ForegroundGameMatchInput,
  target: ScreenshotGameTarget
) =>
  input.foreground.processId !== null &&
  isWindowsGameForegroundProcess(
    input.processes.map((process) => ({
      pid: process.pid,
      parentPid: process.parentPid ?? null,
      exe: process.exe ?? null,
    })),
    input.foreground.processId,
    target.processId,
    target.executablePaths
  );

const matchesLinuxProcessId = (
  input: ForegroundGameMatchInput,
  target: ScreenshotGameTarget,
  processId: number | null | undefined
) =>
  processId != null &&
  isLinuxGameWindowProcess(
    input.processes,
    processId,
    target.processId,
    target.executablePaths,
    target.winePrefixPath
  );

const matchesLinuxTarget = (
  input: ForegroundGameMatchInput,
  target: ScreenshotGameTarget
) => {
  const { foreground } = input;

  if (matchesLinuxProcessId(input, target, foreground.processId)) return true;
  if (matchesLinuxProcessId(input, target, foreground.clientProcessId)) {
    return true;
  }

  if (
    foreground.clientProcessId == null &&
    foreground.processId !== null &&
    input.getNamespacedPids
  ) {
    return matchesSandboxedWindowProcess(
      input.processes,
      foreground.processId,
      target.processId,
      input.getNamespacedPids
    );
  }

  return false;
};

const getForegroundOwnerPid = (foreground: ForegroundWindowInfo) =>
  foreground.clientProcessId ?? foreground.processId;

const ownsForegroundProcess = (
  input: ForegroundGameMatchInput,
  target: ScreenshotGameTarget
) => {
  const ownerPid = getForegroundOwnerPid(input.foreground);
  if (ownerPid == null || target.processId === undefined) return false;
  return collectDescendants(input.processes, target.processId).has(ownerPid);
};

export const findSoleLaunchedTarget = (targets: ScreenshotGameTarget[]) => {
  if (targets.length === 1) return targets[0];
  const launched = targets.filter((target) => target.processId !== undefined);
  return launched.length === 1 ? launched[0] : null;
};

export const isLaunchedForegroundProcess = (
  target: ScreenshotGameTarget,
  foreground: ForegroundWindowInfo
) =>
  target.processId !== undefined &&
  (foreground.processId === target.processId ||
    foreground.clientProcessId === target.processId);

export const findForegroundGameTarget = (
  input: ForegroundGameMatchInput
): ScreenshotGameTarget | null => {
  const matches =
    input.platform === "win32" ? matchesWindowsTarget : matchesLinuxTarget;

  const candidates = input.targets.filter((target) => matches(input, target));
  if (candidates.length <= 1) return candidates[0] ?? null;

  const owners = candidates.filter((target) =>
    ownsForegroundProcess(input, target)
  );
  if (owners.length) return owners.length === 1 ? owners[0] : null;

  return findSoleLaunchedTarget(candidates);
};

export const parseNamespacedPids = (status: string): number[] | null => {
  const line = status
    .split("\n")
    .find((candidate) => candidate.startsWith("NSpid:"));
  if (!line) return null;

  const pids = line
    .slice("NSpid:".length)
    .trim()
    .split(/\s+/)
    .map(Number)
    .filter((pid) => Number.isInteger(pid) && pid > 0);

  return pids.length ? pids : null;
};
