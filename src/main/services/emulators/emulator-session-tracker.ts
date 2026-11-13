import type { ChildProcess } from "node:child_process";

import { gamesSublevel, levelKeys } from "@main/level";
import { EMULATOR_SYSTEMS } from "@shared";
import type { EmulatorSystem, Game, GameShop, RetroArchPlatform } from "@types";

import { trackGamePlaytime } from "../library-sync";
import {
  deleteEmulatorGameRunning,
  setEmulatorGameRunning,
} from "../game-running-state";
import { logger } from "../logger";
import { killWindowsProcessTree } from "@main/helpers/kill-windows-process-tree";
import { syncRetroAchievements } from "../retro-achievements/retro-achievements-sync";
import {
  startEmulatorSouvenirWatcher,
  stopEmulatorSouvenirWatcher,
} from "./emulator-souvenir-watcher";
import { WindowManager } from "../window-manager";
import {
  hasCloudSaveLaunchGuard,
  runAutomaticCloudSavePostExit,
} from "../cloud-save";
import { updateEmulatorConfig } from "./emulators-repository";
import { readEmulatorPlaytimeSeconds } from "./playtime-files";
import {
  findShadps4CorePath,
  findShadps4CorePid,
  readShadps4VersionAfterSession,
} from "./shadps4-files";
import {
  startShadps4TrophyWatcher,
  type Shadps4TrophyWatcher,
} from "./shadps4-trophy-watcher";
import {
  startRpcs3TrophyWatcher,
  type Rpcs3TrophyWatcher,
} from "./rpcs3-trophy-watcher";
import { launchedGamePids } from "../launched-game-pids";
import { NativeAddon } from "../native-addon";
import { stopLinuxGameCaptureSession } from "../linux-game-capture-session";
import {
  cleanupEmulatorSouvenirSession,
  type EmulatorSouvenirSession,
} from "./emulator-souvenir-config";
import {
  onScreenshotGameClosed,
  onScreenshotGameStarted,
} from "../screenshots";

export type EmulatorSessionSystem = EmulatorSystem | RetroArchPlatform;

const isEmulatorSystem = (
  system: EmulatorSessionSystem
): system is EmulatorSystem =>
  EMULATOR_SYSTEMS.includes(system as EmulatorSystem);

export interface EmulatorSession {
  shop: GameShop;
  objectId: string;
  system: EmulatorSessionSystem;
  executablePath: string;
  sku: string | null;
  beforeTotalSeconds: number | null;
  startedAt: number;
  heartbeat: ReturnType<typeof setInterval> | null;
  child: ChildProcess;
  souvenirSession: EmulatorSouvenirSession | null;
  knownShadps4Pids: Set<number>;
  corePath: string | null;
  corePid: number | null;
  coreWatch: ReturnType<typeof setInterval> | null;
  relaunchWatch: ReturnType<typeof setInterval> | null;
  trophyWatcher: Shadps4TrophyWatcher | Rpcs3TrophyWatcher | null;
}

export const emulatorSessions = new Map<string, EmulatorSession>();

const PRESENCE_HEARTBEAT_INTERVAL_MS = 60_000;
const SHADPS4_CORE_POLL_INTERVAL_MS = 2_000;

const isShadps4ProcessName = (name: string): boolean =>
  name.toLowerCase().includes("shadps4");

const listShadps4Processes = async () => {
  const processes = await NativeAddon.listProcesses().catch(() => []);
  return processes.filter(({ name }) => isShadps4ProcessName(name));
};

export const listShadps4ProcessIds = async (): Promise<number[]> =>
  (await listShadps4Processes()).map(({ pid }) => pid);

const isProcessAlive = (pid: number): boolean => {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
};

const isRelaunchedProcessRunning = async (pid: number): Promise<boolean> => {
  if (!isProcessAlive(pid)) return false;

  const processes = await NativeAddon.listProcesses().catch(() => []);
  if (processes.length === 0) return true;

  return processes.some(
    (candidate) => candidate.pid === pid && isShadps4ProcessName(candidate.name)
  );
};

const killRelaunchedProcess = (pid: number): void => {
  try {
    process.kill(pid, "SIGKILL");
  } catch (error) {
    logger.warn("Failed to close relaunched shadPS4 process", error);
  }
};

const listOtherSessionPids = (session: EmulatorSession): number[] =>
  [...emulatorSessions.values()]
    .filter((otherSession) => otherSession !== session)
    .flatMap(({ child, corePid }) => [child.pid, corePid])
    .filter((pid): pid is number => pid != null);

const findUnseenShadps4CorePid = async (
  session: EmulatorSession,
  parentPid: number
): Promise<number | null> =>
  findShadps4CorePid(
    await listShadps4Processes(),
    parentPid,
    new Set([...session.knownShadps4Pids, ...listOtherSessionPids(session)]),
    session.corePath
  );

const adoptShadps4CorePid = (
  gameKey: string,
  session: EmulatorSession,
  corePid: number
): void => {
  session.corePid = corePid;
  session.knownShadps4Pids.add(corePid);
  launchedGamePids.set(gameKey, corePid);
};

const refreshShadps4CorePid = async (
  gameKey: string,
  session: EmulatorSession,
  launcherPid: number
): Promise<void> => {
  const corePid = await findUnseenShadps4CorePid(session, launcherPid);

  if (emulatorSessions.get(gameKey) !== session || corePid === null) return;
  adoptShadps4CorePid(gameKey, session, corePid);
};

const sendPresencePing = async (gameKey: string): Promise<void> => {
  const game = await gamesSublevel.get(gameKey);
  if (!game || game.shop === "custom") return;

  await trackGamePlaytime(game, 0, new Date()).catch((error) => {
    logger.error("Failed to send emulator presence ping", error);
  });
};

const startTrophyWatcher = (
  system: EmulatorSessionSystem,
  gameKey: string,
  executablePath: string,
  discPath: string | undefined
): Shadps4TrophyWatcher | Rpcs3TrophyWatcher | null => {
  if (!discPath) return null;
  if (system === "ps4") {
    return startShadps4TrophyWatcher({ gameKey, executablePath, discPath });
  }
  if (system === "ps3") return startRpcs3TrophyWatcher({ gameKey, discPath });
  return null;
};

interface StartEmulatorSessionOptions {
  game: Game;
  system: EmulatorSessionSystem;
  executablePath: string;
  sku: string | null;
  child: ChildProcess;
  souvenirSession?: EmulatorSouvenirSession | null;
  existingEmulatorPids?: number[];
  discPath?: string;
}

export const startEmulatorSession = async ({
  game,
  system,
  executablePath,
  sku,
  child,
  souvenirSession = null,
  existingEmulatorPids = [],
  discPath,
}: StartEmulatorSessionOptions): Promise<void> => {
  const gameKey = levelKeys.game(game.shop, game.objectId);

  const before =
    sku && isEmulatorSystem(system)
      ? await readEmulatorPlaytimeSeconds(system, executablePath, sku)
      : null;

  const session: EmulatorSession = {
    shop: game.shop,
    objectId: game.objectId,
    system,
    executablePath,
    sku,
    beforeTotalSeconds: before,
    startedAt: performance.now(),
    heartbeat: null,
    child,
    souvenirSession,
    knownShadps4Pids: new Set([
      ...existingEmulatorPids,
      ...(child.pid ? [child.pid] : []),
    ]),
    corePath: system === "ps4" ? findShadps4CorePath(executablePath) : null,
    corePid: null,
    coreWatch: null,
    relaunchWatch: null,
    trophyWatcher: startTrophyWatcher(
      system,
      gameKey,
      executablePath,
      discPath
    ),
  };

  emulatorSessions.set(gameKey, session);
  const launcherPid = child.pid;
  if (system === "ps4" && launcherPid) {
    launchedGamePids.set(gameKey, launcherPid);
    session.coreWatch = setInterval(() => {
      void refreshShadps4CorePid(gameKey, session, launcherPid);
    }, SHADPS4_CORE_POLL_INTERVAL_MS);
    session.coreWatch.unref?.();
  }
  if (system === "ps3" && launcherPid) {
    launchedGamePids.set(gameKey, launcherPid);
  }
  setEmulatorGameRunning(gameKey);
  void onScreenshotGameStarted(gameKey);

  if (game.shop !== "custom") {
    void sendPresencePing(gameKey);
    session.heartbeat = setInterval(() => {
      void sendPresencePing(gameKey);
    }, PRESENCE_HEARTBEAT_INTERVAL_MS);
    session.heartbeat.unref?.();
  }

  if (game.shop === "launchbox") {
    const souvenirWatcherToken = {};

    void startEmulatorSouvenirWatcher({
      gameKey,
      game,
      system,
      executablePath,
      processId: child.pid ?? 0,
      watcherToken: souvenirWatcherToken,
      logPath: souvenirSession?.logPath ?? undefined,
      logOffset: souvenirSession?.logOffset ?? undefined,
    })
      .then(() => {
        if (emulatorSessions.get(gameKey) !== session) {
          stopEmulatorSouvenirWatcher(gameKey, souvenirWatcherToken);
        }
      })
      .catch((error) => {
        logger.error("Failed to start emulator souvenir watcher", error);
      });
  }

  const finalize = () => {
    void finalizeOrFollowRelaunch(gameKey, session);
  };

  child.once("exit", finalize);
  child.once("error", finalize);

  if (child.exitCode !== null || child.signalCode !== null) {
    finalize();
  }
};

export const closeEmulatorSession = (gameKey: string): boolean => {
  const session = emulatorSessions.get(gameKey);
  if (!session) return false;

  const { pid } = session.child;
  stopLinuxGameCaptureSession(gameKey);

  if (session.relaunchWatch && session.corePid) {
    killRelaunchedProcess(session.corePid);
  } else if (session.system === "ps4" && pid && process.platform === "win32") {
    killWindowsProcessTree(pid, "shadPS4");
    return true;
  }

  try {
    if (pid && process.platform !== "win32") {
      process.kill(-pid, "SIGKILL");
    } else {
      session.child.kill();
    }
  } catch {
    try {
      session.child.kill();
    } catch (error) {
      logger.error("Failed to close emulator session", error);
      return false;
    }
  }

  return true;
};

export const stopAllEmulatorSouvenirCaptureSessions = async () => {
  for (const [gameKey, session] of emulatorSessions) {
    stopEmulatorSouvenirWatcher(gameKey);
    await cleanupEmulatorSouvenirSession(session.souvenirSession);
    session.souvenirSession = null;
  }
};

const finalizeOrFollowRelaunch = async (
  gameKey: string,
  session: EmulatorSession
): Promise<void> => {
  if (emulatorSessions.get(gameKey) !== session || session.relaunchWatch) {
    return;
  }

  const relaunchedPid =
    session.corePid === null
      ? null
      : await findUnseenShadps4CorePid(session, session.corePid);

  if (emulatorSessions.get(gameKey) !== session || session.relaunchWatch) {
    return;
  }

  if (relaunchedPid === null) {
    await finalizeEmulatorSession(gameKey);
    return;
  }

  if (session.coreWatch) clearInterval(session.coreWatch);
  session.coreWatch = null;
  adoptShadps4CorePid(gameKey, session, relaunchedPid);
  session.relaunchWatch = setInterval(() => {
    void followRelaunchedProcess(gameKey, session, relaunchedPid);
  }, SHADPS4_CORE_POLL_INTERVAL_MS);
  session.relaunchWatch.unref?.();
};

const followRelaunchedProcess = async (
  gameKey: string,
  session: EmulatorSession,
  relaunchedPid: number
): Promise<void> => {
  if (await isRelaunchedProcessRunning(relaunchedPid)) return;
  if (!session.relaunchWatch) return;

  clearInterval(session.relaunchWatch);
  session.relaunchWatch = null;
  await finalizeOrFollowRelaunch(gameKey, session);
};

const refreshShadps4DetectedVersion = async (
  executablePath: string
): Promise<void> => {
  const detectedVersion = readShadps4VersionAfterSession(executablePath);
  if (!detectedVersion) return;

  await updateEmulatorConfig("ps4", (current) =>
    current.executablePath === executablePath
      ? { ...current, detectedVersion }
      : current
  ).catch((error) => {
    logger.warn("Failed to store shadPS4 version", error);
  });
};

const resolveSessionPlaytimeSeconds = async (
  session: EmulatorSession
): Promise<number> => {
  let deltaSeconds = 0;
  if (session.sku && isEmulatorSystem(session.system)) {
    const after = await readEmulatorPlaytimeSeconds(
      session.system,
      session.executablePath,
      session.sku
    );
    const before = session.beforeTotalSeconds;
    if (after !== null && before === null && after > 0) {
      deltaSeconds = after;
    } else if (after !== null && before !== null && after > before) {
      deltaSeconds = after - before;
    }
  }

  return deltaSeconds > 0
    ? deltaSeconds
    : Math.max(0, (performance.now() - session.startedAt) / 1000);
};

const finalizeEmulatorSession = async (gameKey: string): Promise<void> => {
  const session = emulatorSessions.get(gameKey);
  if (!session) return;
  emulatorSessions.delete(gameKey);
  deleteEmulatorGameRunning(gameKey);
  stopLinuxGameCaptureSession(gameKey);
  onScreenshotGameClosed(gameKey);
  if (session.heartbeat) clearInterval(session.heartbeat);
  if (session.coreWatch) clearInterval(session.coreWatch);
  if (session.relaunchWatch) clearInterval(session.relaunchWatch);
  stopEmulatorSouvenirWatcher(gameKey);
  if (session.system === "ps4" || session.system === "ps3") {
    launchedGamePids.delete(gameKey);
  }
  const trophyWatcherFinished = session.trophyWatcher?.finish();
  await cleanupEmulatorSouvenirSession(session.souvenirSession);

  const game = await gamesSublevel.get(gameKey);
  if (!game) return;

  const deltaMs = (await resolveSessionPlaytimeSeconds(session)) * 1000;
  const updated: Game = {
    ...game,
    playTimeInMilliseconds: (game.playTimeInMilliseconds ?? 0) + deltaMs,
    lastTimePlayed: new Date(),
  };

  await gamesSublevel.put(gameKey, updated);
  await trophyWatcherFinished;

  if (session.system === "ps4") {
    await refreshShadps4DetectedVersion(session.executablePath);
  }

  if (game.shop === "custom") return;

  const pendingDelta =
    deltaMs + (game.unsyncedDeltaPlayTimeInMilliseconds ?? 0);

  trackGamePlaytime(updated, pendingDelta, updated.lastTimePlayed!)
    .then(() => {
      WindowManager.sendToAppWindows("on-game-session-synced");
      return gamesSublevel.put(gameKey, {
        ...updated,
        unsyncedDeltaPlayTimeInMilliseconds: 0,
      });
    })
    .catch((error) => {
      logger.error("Failed to sync emulator playtime", error);
      return gamesSublevel.put(gameKey, {
        ...updated,
        unsyncedDeltaPlayTimeInMilliseconds: pendingDelta,
      });
    });

  if (game.shop === "launchbox") {
    if (hasCloudSaveLaunchGuard(game.objectId, game.shop)) {
      void runAutomaticCloudSavePostExit(game.objectId, game.shop).catch(
        (error) => {
          logger.error("Failed to sync emulator save after exit", error);
        }
      );
    }
    syncRetroAchievements({
      objectId: game.objectId,
      shop: game.shop,
    })
      .then((result) => {
        if (!result.didChange) return;

        WindowManager.mainWindow?.webContents.send(
          `on-update-achievements-${game.objectId}-${game.shop}`,
          result.achievements
        );
      })
      .catch((error) => {
        logger.error("Failed to sync RetroAchievements on session end", error);
      });
  }
};
