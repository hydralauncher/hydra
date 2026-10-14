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
  type EpicLinuxProcessContext,
} from "./managed-process-tracker.js";
import type {
  PreparedEpicLinuxContext,
  EpicLinuxPrefixLease,
} from "./linux-runtime";
import type { UmuProcessHandle } from "../umu-supervised-process";
import {
  prepareEpicOwnershipToken,
  type EpicOwnershipToken,
} from "./ownership-token.js";
import { resolveEpicWindowsPath } from "./windows-path.js";
import type { UmuStatusListener } from "../umu-launch-monitor";
import type {
  EpicPlaytimeReporter,
  EpicPlaytimeSession,
} from "./playtime-reporter";

interface ManagedSession {
  session: EpicSaveSession;
  detected: boolean;
  timer: ReturnType<typeof setTimeout>;
  tracker?: EpicManagedProcessTracker;
  verifiedPaths: Set<string>;
  processObserved: boolean;
  processState?: string;
  playtime?: EpicPlaytimeSession;
  resources?: LaunchResources;
  disconnected?: boolean;
  complete?: boolean;
}
interface LaunchResources {
  linuxContext: PreparedEpicLinuxContext;
  lease: EpicLinuxPrefixLease;
  token?: EpicOwnershipToken;
  handle?: UmuProcessHandle;
  releasePromise?: Promise<void>;
}
const preparedResources = new Map<EpicSaveSession, LaunchResources>();
const preparations = new Map<AbortController, Promise<unknown>>();
async function releaseResources(session: EpicSaveSession, terminate = false) {
  const resources = preparedResources.get(session);
  if (!resources) return;
  if (resources.releasePromise) return resources.releasePromise;
  resources.releasePromise = (async () => {
    // A failed termination must retain the prefix lease and ownership token.
    if (terminate && resources.handle) await resources.handle.terminate();
    await resources.token?.dispose();
    resources.lease.release();
    preparedResources.delete(session);
  })().catch(() => {
    resources.releasePromise = undefined;
    throw new EpicSaveFailure("cleanup-failed");
  });
  return resources.releasePromise;
}
const managedSessions = new Map<string, ManagedSession>();
type EpicLaunchDependencies = EpicCloudSaveDependencies & {
  playtime?: EpicPlaytimeReporter;
};
let dependencies: EpicLaunchDependencies | null = null;
export const configureEpicLaunch = (value: EpicLaunchDependencies) => {
  dependencies = value;
};

export function prepareManagedEpicLaunch(
  game: Game,
  actualExecutable: string,
  options: {
    winePrefixPath?: string | null;
    epicSavePolicy?: "local-once";
    epicOffline?: boolean;
    onStatus?: UmuStatusListener;
  } = {}
): Promise<{
  parameters: EpicLaunchParameters;
  session: EpicSaveSession;
  linuxContext?: PreparedEpicLinuxContext;
  linuxLease?: EpicLinuxPrefixLease;
}> {
  const controller = new AbortController();
  const operation = Promise.resolve().then(() =>
    prepareLaunch(game, actualExecutable, options, controller)
  );
  preparations.set(controller, operation);
  void operation
    .finally(() => preparations.delete(controller))
    .catch(() => undefined);
  return operation;
}

async function prepareLaunch(
  game: Game,
  actualExecutable: string,
  options: NonNullable<Parameters<typeof prepareManagedEpicLaunch>[2]>,
  controller: AbortController
) {
  if (!dependencies) throw new EpicSaveFailure("legendary-unavailable");
  const cloud = getEpicCloudSaveService();
  let session = await cloud.capture(
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
  let resources: LaunchResources | undefined;
  try {
    if (process.platform === "linux") {
      const runtime = await import("./linux-runtime");
      const context = await runtime.ensureEpicLinuxPrerequisites({
        game,
        target: session.target,
        installed: session.installed,
        signal: controller.signal,
        offline: options.epicOffline,
        onStatus: options.onStatus,
      });
      if (session.installed.prereq_info)
        await dependencies.installation.confirmPrerequisites(
          session.target,
          session.installed,
          controller.signal
        );
      const lease = await runtime.acquireEpicLinuxPrefixSession(context);
      resources = { linuxContext: context, lease };
      // Prefix preparation can create or replace its profile; capture save paths again.
      session = await cloud.capture(
        game.objectId,
        controller.signal,
        context.winePrefixPath,
        options.epicOffline === true
      );
      session.linuxPrefixLeaseId = lease.id;
      preparedResources.set(session, resources);
      resources.token = await prepareEpicOwnershipToken(
        dependencies.runtime.workspace(session.target),
        game.objectId,
        session.installed.requires_ot === true && options.epicOffline !== true,
        (directory) =>
          runtime.mapEpicLinuxPath(context, directory, controller.signal)
      );
    }
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
    let parameters = parseEpicLaunchParameters(
      result,
      session.installed.installPath,
      session.installed.executablePath,
      path,
      process.platform === "linux"
    );
    if (resources) {
      const [executable, workingDirectory] = await Promise.all([
        resolveEpicWindowsPath(
          session.installed.installPath,
          path.relative(session.installed.installPath, parameters.executable)
        ),
        path.relative(
          session.installed.installPath,
          parameters.workingDirectory
        ) === ""
          ? Promise.resolve(session.installed.installPath)
          : resolveEpicWindowsPath(
              session.installed.installPath,
              path.relative(
                session.installed.installPath,
                parameters.workingDirectory
              )
            ),
      ]);
      if (!executable || !workingDirectory)
        throw new EpicSaveFailure("invalid-path");
      parameters = await resources.token!.translate({
        ...parameters,
        executable,
        workingDirectory,
      });
    }
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
    dependencies.runtime.assertCurrent(session.target, controller.signal);
    return {
      parameters: {
        ...parameters,
        executable: realExecutable,
        workingDirectory: realWorkingDirectory,
      },
      session,
      linuxContext: resources?.linuxContext,
      linuxLease: resources?.lease,
    };
  } catch (error) {
    if (resources) {
      preparedResources.set(session, resources);
      await releaseResources(session);
    }
    throw error;
  }
}

export async function markManagedEpicLaunched(session: EpicSaveSession) {
  const key = levelKeys.game("epic", session.objectId);
  const old = managedSessions.get(key);
  if (old) clearTimeout(old.timer);
  await getEpicCloudSaveService().markSessionStarted(session);
  const entry: ManagedSession = {
    session,
    detected: false,
    processObserved: false,
    verifiedPaths: new Set([session.installed.executablePath]),
    resources: preparedResources.get(session),
    timer: setTimeout(() => {
      if (managedSessions.get(key) === entry && !entry.detected) {
        void cancelManagedEpicLaunch(entry.session).catch(() => {
          logger.warn("Epic managed launch cleanup remains pending", {
            objectId: session.objectId,
          });
        });
      }
    }, EPIC_LAUNCH_DETECTION_TIMEOUT_MS),
  };
  managedSessions.set(key, entry);
}

export function recordManagedEpicProcess(
  session: EpicSaveSession,
  pid: number,
  linuxContext?: EpicLinuxProcessContext,
  handle?: UmuProcessHandle
) {
  const entry = managedSessions.get(levelKeys.game("epic", session.objectId));
  if (entry?.session === session) {
    entry.tracker = new EpicManagedProcessTracker(
      pid,
      session.installed.installPath,
      linuxContext
    );
    if (entry.resources) entry.resources.handle = handle;
    logger.info("Epic managed launch process captured", {
      objectId: session.objectId,
      pid,
    });
  }
}
export async function getManagedEpicProcessMatch(
  gameKey: string,
  processes: EpicProcessNode[] | undefined
) {
  const entry = managedSessions.get(gameKey);
  if (!entry) return { managed: false, complete: true, path: null };
  if (!processes || !entry.tracker) {
    entry.processObserved = false;
    if (entry.playtime) dependencies?.playtime?.interrupt(entry.playtime);
    return { managed: true, complete: false, path: null };
  }
  const result = await entry.tracker.scan(processes);
  entry.complete = result.complete && result.paths.length === 0;
  for (const candidate of result.paths) entry.verifiedPaths.add(candidate);
  // A verified game process proves active play even when an external overlay
  // prevents the scan from proving that the entire launch tree has closed.
  entry.processObserved = result.paths.length > 0;
  if (entry.disconnected && entry.processObserved) {
    entry.detected = true;
    clearTimeout(entry.timer);
  }
  const processState = `${result.complete}:${result.paths.length}`;
  if (entry.processState !== processState) {
    entry.processState = processState;
    logger.info("Epic managed process observation changed", {
      objectId: entry.session.objectId,
      complete: result.complete,
      verifiedProcesses: result.paths.length,
    });
  }
  if (
    !entry.disconnected &&
    entry.detected &&
    entry.processObserved &&
    !entry.playtime
  )
    entry.playtime = dependencies?.playtime?.begin(
      entry.session.objectId,
      entry.session.target
    );
  if (entry.playtime) {
    if (entry.processObserved) dependencies?.playtime?.observe(entry.playtime);
    else dependencies?.playtime?.interrupt(entry.playtime);
  }
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
  if (!entry.detected && entry.processObserved)
    entry.playtime = dependencies.playtime?.begin(
      game.objectId,
      entry.session.target
    );
  entry.detected = true;
  logger.info("Epic managed game session detected", {
    objectId: game.objectId,
    reportingPlaytime: !!entry.playtime,
  });
  clearTimeout(entry.timer);
  return true;
}

export function onManagedEpicClosed(game: Game) {
  const key = levelKeys.game(game.shop, game.objectId);
  const entry = managedSessions.get(key);
  if (!entry?.detected || (entry.resources && !entry.complete)) return false;
  managedSessions.delete(key);
  clearTimeout(entry.timer);
  if (entry.playtime) dependencies?.playtime?.finish(entry.playtime);
  logger.info("Epic managed game session closed", {
    objectId: game.objectId,
    reportingPlaytime: !!entry.playtime,
  });
  // Only a real watcher close owns this upload; the JSON-producing CLI has already exited.
  const closing = entry.disconnected
    ? Promise.resolve(getEpicCloudSaveService().endSession(entry.session))
    : getEpicCloudSaveService().afterClose(entry.session);
  void closing
    .catch(() => {
      logger.warn("Epic save upload remains pending after the game session", {
        objectId: game.objectId,
      });
    })
    .finally(() => releaseResources(entry.session))
    .catch(() => {
      logger.warn("Epic session resource cleanup remains pending", {
        objectId: game.objectId,
      });
    });
  return true;
}
export const hasManagedEpicSession = (gameKey: string) =>
  managedSessions.has(gameKey);
export const interruptManagedEpicPlaytime = () => {
  for (const entry of managedSessions.values()) entry.processObserved = false;
  dependencies?.playtime?.interruptAll();
};
export async function cancelManagedEpicLaunch(session: EpicSaveSession) {
  const key = levelKeys.game("epic", session.objectId);
  const entry = managedSessions.get(key);
  if (entry?.session === session && !entry.detected) {
    await releaseResources(session, true);
    clearTimeout(entry.timer);
    getEpicCloudSaveService().endSession(session);
    managedSessions.delete(key);
  } else if (!entry) {
    await releaseResources(session, true);
  }
}
export async function clearManagedEpicSessions() {
  for (const controller of preparations.keys()) controller.abort();
  const preparationResults = await Promise.allSettled([
    ...preparations.values(),
  ]);
  const cleanup: Promise<unknown>[] = [];
  for (const entry of managedSessions.values()) {
    if (entry.playtime) dependencies?.playtime?.discard(entry.playtime);
    if (entry.resources?.handle) {
      entry.playtime = undefined;
      entry.disconnected = true;
      // Keep only process/resource attribution until real exit, even after signout.
      continue;
    }
    clearTimeout(entry.timer);
    getEpicCloudSaveService().endSession(entry.session);
    cleanup.push(releaseResources(entry.session, true));
    managedSessions.delete(levelKeys.game("epic", entry.session.objectId));
  }
  for (const [session, resources] of preparedResources) {
    if (!resources.handle) cleanup.push(releaseResources(session, true));
  }
  // Cancellation is an expected result; a cleanup failure retains its lease.
  const results = [
    ...preparationResults,
    ...(await Promise.allSettled(cleanup)),
  ];
  if (
    results.some(
      (result) =>
        result.status === "rejected" &&
        (result.reason as { code?: string }).code === "cleanup-failed"
    )
  )
    throw new EpicSaveFailure("cleanup-failed");
}
