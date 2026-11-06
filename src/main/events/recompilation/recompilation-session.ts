import type { ChildProcess } from "node:child_process";

import type { Game, RecompilationDetails, RecompilationRef } from "@types";
import { toRecompilationCloudSaveObjectId } from "@shared";

import { gamesSublevel, levelKeys } from "@main/level";
import {
  canCreateCloudSaveUploadGuard,
  canRunAutomaticCloudSaveSync,
  clearCloudSaveLaunchGuard,
  getCloudSaveGameContext,
  hasCloudSaveLaunchGuard,
  runAutomaticCloudSavePostExit,
  runAutomaticCloudSaveSyncDetailed,
  setCloudSaveLaunchGuard,
} from "@main/services/cloud-save";
import {
  deleteEmulatorGameRunning,
  deleteRecompilationGameRunning,
  setEmulatorGameRunning,
  setRecompilationGameRunning,
} from "@main/services/game-running-state";
import { HydraApi } from "@main/services/hydra-api";
import { createGame, trackGamePlaytime } from "@main/services/library-sync";
import { getHydraPlaytimeRevision } from "@main/services/library-sync/library-write-queue";
import { persistGamePlaytime } from "@main/services/process-watcher";
import { logger } from "@main/services/logger";
import { WindowManager } from "@main/services/window-manager";
import { isRecompilationCloudSaveEnabled } from "./recompilation-features";

const SHOP = "launchbox";
const PRESENCE_HEARTBEAT_INTERVAL_MS = 60_000;
const CLOSE_GRACE_PERIOD_MS = 10_000;

interface RecompilationSession {
  ref: RecompilationRef;
  child: ChildProcess;
  startedAt: number;
  heartbeat: ReturnType<typeof setInterval> | null;
  baseGameReady: Promise<void>;
}

const sessions = new Map<string, RecompilationSession>();

const cloudSaveObjectId = (ref: RecompilationRef) =>
  toRecompilationCloudSaveObjectId(ref.objectId, ref.slug);

const portKeyOf = (ref: RecompilationRef) =>
  levelKeys.game(SHOP, cloudSaveObjectId(ref));

const baseKeyOf = (ref: RecompilationRef) => levelKeys.game(SHOP, ref.objectId);

export const prepareRecompilationCloudSave = async (
  ref: RecompilationRef
): Promise<boolean> => {
  if (!(await isRecompilationCloudSaveEnabled())) return true;

  const objectId = cloudSaveObjectId(ref);
  if (!(await canRunAutomaticCloudSaveSync(objectId, SHOP))) return true;

  const context = await getCloudSaveGameContext(objectId, SHOP).catch(
    () => null
  );
  if (!context) return true;

  const outcome = await runAutomaticCloudSaveSyncDetailed(
    objectId,
    SHOP,
    "pre-launch",
    context
  );
  if (outcome.result?.action === "conflict") {
    WindowManager.redirectToMainWindow(
      `recompilation/${ref.objectId}/${ref.slug}?openCloudSaveConflict=1`
    );
    return false;
  }
  if (outcome.result) {
    setCloudSaveLaunchGuard(objectId, SHOP, {
      environmentId: context.environmentId,
      baseRemoteHash: outcome.result.remoteHash ?? null,
      uploadAllowed: canCreateCloudSaveUploadGuard(
        context.prefixIdentityMode !== "session",
        context.environmentId,
        outcome.result
      ),
      createdAt: new Date().toISOString(),
    });
  }
  return true;
};

export const clearRecompilationCloudSaveGuard = (ref: RecompilationRef) =>
  clearCloudSaveLaunchGuard(cloudSaveObjectId(ref), SHOP);

const fetchBaseGameDetails = (ref: RecompilationRef) =>
  HydraApi.get<RecompilationDetails>(
    `/games/launchbox/${ref.objectId}/recompilations/${ref.slug}`,
    undefined,
    { needsAuth: false }
  )
    .then((details) => details.game)
    .catch(() => null);

const getOrAddBaseGame = async (ref: RecompilationRef): Promise<Game> => {
  const key = baseKeyOf(ref);
  const existing = await gamesSublevel.get(key);
  if (existing && !existing.isDeleted) {
    if (!existing.remoteId && HydraApi.isLoggedIn()) {
      await createGame(existing).catch(() => {});
    }
    return existing;
  }

  const details = await fetchBaseGameDetails(ref);
  const game: Game = existing
    ? {
        ...existing,
        isDeleted: false,
        addedToLibraryAt: new Date(),
        platform: existing.platform ?? details?.platform ?? null,
      }
    : {
        title: details?.title ?? ref.slug,
        iconUrl: details?.iconUrl ?? null,
        libraryHeroImageUrl: details?.libraryHeroImageUrl ?? null,
        logoImageUrl: details?.logoImageUrl ?? null,
        objectId: ref.objectId,
        shop: SHOP,
        remoteId: null,
        isDeleted: false,
        playTimeInMilliseconds: 0,
        lastTimePlayed: null,
        addedToLibraryAt: new Date(),
        platform: details?.platform ?? null,
        source: "hydra",
      };
  await gamesSublevel.put(key, game);
  WindowManager.sendToAppWindows("on-library-batch-complete");
  if (HydraApi.isLoggedIn()) await createGame(game).catch(() => {});
  return game;
};

const sendPresencePing = async (baseKey: string) => {
  if (!HydraApi.isLoggedIn()) return;
  const game = await gamesSublevel.get(baseKey);
  if (!game?.remoteId) return;
  await trackGamePlaytime(game, 0, new Date()).catch((error) => {
    logger.error("Failed to send recompilation presence ping", error);
  });
};

const creditPlaytime = async (baseKey: string, deltaMs: number) => {
  const game = await gamesSublevel.get(baseKey);
  if (!game) return;

  const authContext = HydraApi.getAuthContext();
  const hydraRevision = getHydraPlaytimeRevision(baseKey);
  const deltaToSync = deltaMs + (game.unsyncedDeltaPlayTimeInMilliseconds ?? 0);
  const lastTimePlayed = new Date();

  await persistGamePlaytime(baseKey, { lastTimePlayed }, authContext, deltaMs);
  WindowManager.sendToAppWindows("on-library-batch-complete");

  if (!game.remoteId) {
    await createGame({ ...game, lastTimePlayed }).catch((error) => {
      logger.error(
        "Failed to add the recompilation's game to the profile",
        error
      );
    });
    return;
  }

  await trackGamePlaytime(game, deltaToSync, lastTimePlayed)
    .then(() => {
      WindowManager.sendToAppWindows("on-game-session-synced");
      return persistGamePlaytime(
        baseKey,
        { unsyncedDeltaPlayTimeInMilliseconds: 0 },
        authContext,
        undefined,
        hydraRevision
      );
    })
    .catch((error) => {
      logger.error("Failed to sync recompilation playtime", error);
      return persistGamePlaytime(
        baseKey,
        { unsyncedDeltaPlayTimeInMilliseconds: deltaToSync },
        authContext,
        undefined,
        hydraRevision
      );
    });
};

const endSession = (session: RecompilationSession) => {
  const portKey = portKeyOf(session.ref);
  sessions.delete(portKey);
  if (session.heartbeat) clearInterval(session.heartbeat);
  deleteEmulatorGameRunning(portKey);
  deleteRecompilationGameRunning(portKey);
  return Math.max(0, performance.now() - session.startedAt);
};

const finishSession = async (session: RecompilationSession) => {
  const deltaMs = endSession(session);
  const objectId = cloudSaveObjectId(session.ref);

  const backup = hasCloudSaveLaunchGuard(objectId, SHOP)
    ? runAutomaticCloudSavePostExit(objectId, SHOP).catch((error) => {
        logger.error("Failed to sync recompilation save after exit", error);
      })
    : Promise.resolve();

  await session.baseGameReady;
  await creditPlaytime(baseKeyOf(session.ref), deltaMs).catch((error) => {
    logger.error("Failed to save recompilation playtime", error);
  });
  await backup;
};

export const startRecompilationSession = async (
  ref: RecompilationRef,
  child: ChildProcess
) => {
  const portKey = portKeyOf(ref);
  const baseKey = baseKeyOf(ref);

  const session: RecompilationSession = {
    ref,
    child,
    startedAt: performance.now(),
    heartbeat: null,
    baseGameReady: getOrAddBaseGame(ref)
      .then(() => undefined)
      .catch((error) => {
        logger.error(
          "Failed to add the recompilation's game to the library",
          error
        );
      }),
  };
  sessions.set(portKey, session);
  setEmulatorGameRunning(portKey);
  setRecompilationGameRunning(portKey, baseKey, ref.slug);

  const finish = () => {
    if (sessions.get(portKey) !== session) return;
    void finishSession(session);
  };
  child.once("exit", finish);
  child.once("error", finish);
  if (child.exitCode !== null || child.signalCode !== null) finish();

  await session.baseGameReady;
  if (sessions.get(portKey) !== session) return;

  void sendPresencePing(baseKey);
  session.heartbeat = setInterval(() => {
    void sendPresencePing(baseKey);
  }, PRESENCE_HEARTBEAT_INTERVAL_MS);
  session.heartbeat.unref?.();
};

export const isRecompilationRunning = (ref: RecompilationRef) =>
  sessions.has(portKeyOf(ref));

export const findRunningRecompilation = (objectId: string) =>
  [...sessions.values()].find((session) => session.ref.objectId === objectId)
    ?.ref ?? null;

const signalProcessGroup = (pid: number, signal: NodeJS.Signals) => {
  try {
    process.kill(-pid, signal);
    return true;
  } catch {
    return false;
  }
};

export const closeRecompilation = (ref: RecompilationRef) => {
  const session = sessions.get(portKeyOf(ref));
  if (!session) return false;

  const { pid } = session.child;
  if (!pid || process.platform === "win32") return session.child.kill();
  if (!signalProcessGroup(pid, "SIGTERM")) return session.child.kill();

  setTimeout(
    () => signalProcessGroup(pid, "SIGKILL"),
    CLOSE_GRACE_PERIOD_MS
  ).unref();
  return true;
};

export const saveRecompilationPlaytimeOnQuit = async () => {
  await Promise.all(
    Array.from(sessions.values(), async (session) => {
      const deltaMs = endSession(session);
      const baseKey = baseKeyOf(session.ref);
      const game = await gamesSublevel.get(baseKey);
      if (!game) return;
      await persistGamePlaytime(
        baseKey,
        {
          lastTimePlayed: new Date(),
          unsyncedDeltaPlayTimeInMilliseconds:
            deltaMs + (game.unsyncedDeltaPlayTimeInMilliseconds ?? 0),
        },
        HydraApi.getAuthContext(),
        deltaMs
      );
    })
  );
};
