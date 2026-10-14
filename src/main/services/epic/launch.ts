import fs from "node:fs/promises";
import path from "node:path";
import type { Game } from "@types";
import { levelKeys } from "@main/level";
import { logger } from "../logger";
import type { EpicCloudSaveDependencies, EpicSaveSession } from "./cloud-saves";
import { getEpicCloudSaveService } from "./cloud-saves";
import { EpicSaveFailure } from "./cloud-save-protocol.js";
import {
  parseEpicLaunchParameters,
  type EpicLaunchParameters,
} from "./launch-protocol.js";
import { EPIC_LAUNCH_DETECTION_TIMEOUT_MS } from "./constants.js";
import { isPathInside } from "./session-attribution.js";
import {
  EpicManagedProcessTracker,
  type EpicProcessNode,
} from "./managed-process-tracker.js";

interface ManagedSession {
  session: EpicSaveSession;
  detected: boolean;
  timer: ReturnType<typeof setTimeout>;
  tracker?: EpicManagedProcessTracker;
  verifiedPaths: Set<string>;
}
const managedSessions = new Map<string, ManagedSession>();
let dependencies: EpicCloudSaveDependencies | null = null;
export const configureEpicLaunch = (value: EpicCloudSaveDependencies) => {
  dependencies = value;
};

export async function prepareManagedEpicLaunch(
  game: Game,
  actualExecutable: string,
  options: {
    winePrefixPath?: string | null;
    epicSavePolicy?: "local-once";
    epicOffline?: boolean;
  } = {}
): Promise<{ parameters: EpicLaunchParameters; session: EpicSaveSession }> {
  if (!dependencies) throw new EpicSaveFailure("legendary-unavailable");
  const controller = new AbortController();
  const cloud = getEpicCloudSaveService();
  const session = await cloud.capture(
    game.objectId,
    controller.signal,
    options.winePrefixPath,
    options.epicOffline === true
  );
  const actual = await fs.realpath(actualExecutable).catch(() => null);
  if (!actual || path.relative(session.installed.executablePath, actual) !== "")
    throw new EpicSaveFailure("invalid-path");
  const key = levelKeys.game("epic", game.objectId);
  if (managedSessions.has(key)) throw new EpicSaveFailure("game-running");
  if (options.epicOffline && session.installed.can_run_offline !== true)
    throw new EpicSaveFailure("not-installable");
  await cloud.beforeLaunch(
    session,
    options.epicSavePolicy === "local-once" || options.epicOffline === true
  );
  const result = options.epicOffline
    ? await dependencies.runtime.runOfflineLaunch(session.target, {
        signal: controller.signal,
      })
    : await dependencies.runtime.runJson(
        session.target,
        ["launch", session.target.artifactId, "--json", "--no-wine"],
        { signal: controller.signal }
      );
  const parameters = parseEpicLaunchParameters(
    result,
    session.installed.installPath,
    session.installed.executablePath
  );
  const [realExecutable, realWorkingDirectory] = await Promise.all([
    fs.realpath(parameters.executable),
    fs.realpath(parameters.workingDirectory),
  ]);
  if (
    path.relative(session.installed.executablePath, realExecutable) !== "" ||
    (path.relative(session.installed.installPath, realWorkingDirectory) !==
      "" &&
      !isPathInside(session.installed.installPath, realWorkingDirectory))
  )
    throw new EpicSaveFailure("invalid-path");
  dependencies.runtime.assertCurrent(session.target);
  return {
    parameters: {
      ...parameters,
      executable: realExecutable,
      workingDirectory: realWorkingDirectory,
    },
    session,
  };
}

export async function markManagedEpicLaunched(session: EpicSaveSession) {
  const key = levelKeys.game("epic", session.objectId);
  const old = managedSessions.get(key);
  if (old) clearTimeout(old.timer);
  await getEpicCloudSaveService().markSessionStarted(session);
  const entry: ManagedSession = {
    session,
    detected: false,
    verifiedPaths: new Set([session.installed.executablePath]),
    timer: setTimeout(() => {
      if (managedSessions.get(key) === entry && !entry.detected) {
        getEpicCloudSaveService().endSession(entry.session);
        managedSessions.delete(key);
      }
    }, EPIC_LAUNCH_DETECTION_TIMEOUT_MS),
  };
  managedSessions.set(key, entry);
}

export function recordManagedEpicProcess(
  session: EpicSaveSession,
  pid: number
) {
  const entry = managedSessions.get(levelKeys.game("epic", session.objectId));
  if (entry?.session === session)
    entry.tracker = new EpicManagedProcessTracker(
      pid,
      session.installed.installPath
    );
}
export async function getManagedEpicProcessMatch(
  gameKey: string,
  processes: EpicProcessNode[] | undefined
) {
  const entry = managedSessions.get(gameKey);
  if (!entry) return { managed: false, complete: true, path: null };
  if (!processes || !entry.tracker)
    return { managed: true, complete: false, path: null };
  const result = await entry.tracker.scan(processes);
  for (const candidate of result.paths) entry.verifiedPaths.add(candidate);
  return {
    managed: true,
    complete: result.complete,
    path: result.paths[0] ?? null,
  };
}

export async function onManagedEpicDetected(
  game: Game,
  actualExecutable: string
) {
  const entry = managedSessions.get(levelKeys.game(game.shop, game.objectId));
  if (!entry || game.shop !== "epic") return false;
  if (!dependencies?.runtime.current(entry.session.target)) return false;
  const executable = await fs.realpath(actualExecutable).catch(() => null);
  if (!executable || !entry.verifiedPaths.has(executable)) return false;
  entry.detected = true;
  clearTimeout(entry.timer);
  return true;
}

export function onManagedEpicClosed(game: Game) {
  const key = levelKeys.game(game.shop, game.objectId);
  const entry = managedSessions.get(key);
  if (!entry?.detected) return false;
  managedSessions.delete(key);
  clearTimeout(entry.timer);
  // Only a real watcher close owns this upload; the JSON-producing CLI has already exited.
  void getEpicCloudSaveService()
    .afterClose(entry.session)
    .catch(() => {
      logger.warn("Epic save upload remains pending after the game session", {
        objectId: game.objectId,
      });
    });
  return true;
}
export const hasManagedEpicSession = (gameKey: string) =>
  managedSessions.has(gameKey);
export function cancelManagedEpicLaunch(session: EpicSaveSession) {
  const key = levelKeys.game("epic", session.objectId);
  const entry = managedSessions.get(key);
  if (entry?.session === session && !entry.detected) {
    clearTimeout(entry.timer);
    getEpicCloudSaveService().endSession(session);
    managedSessions.delete(key);
  }
}
export function clearManagedEpicSessions() {
  for (const entry of managedSessions.values()) {
    clearTimeout(entry.timer);
    getEpicCloudSaveService().endSession(entry.session);
  }
  managedSessions.clear();
}
