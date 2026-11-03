import type { ChildProcess } from "node:child_process";

import type { Game, RecompilationDetails, RecompilationRef } from "@types";
import { toRecompilationCloudSaveObjectId } from "@shared";

import { gamesSublevel, levelKeys } from "@main/level";
import {
  canCreateCloudSaveUploadGuard,
  canRunAutomaticCloudSaveSync,
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
import { logger } from "@main/services/logger";
import { WindowManager } from "@main/services/window-manager";

const SHOP = "launchbox";
const PRESENCE_HEARTBEAT_INTERVAL_MS = 60_000;

interface RecompilationSession {
  child: ChildProcess;
  startedAt: number;
  heartbeat: ReturnType<typeof setInterval> | null;
  /** Settles once the base game is in the library, to credit playtime. */
  baseGameReady: Promise<void>;
}

/** Running ports, keyed by the port's cloud save game key. */
const sessions = new Map<string, RecompilationSession>();

const cloudSaveObjectId = (ref: RecompilationRef) =>
  toRecompilationCloudSaveObjectId(ref.objectId, ref.slug);

/**
 * Restores the port's cloud save before it starts, like the Classics do for
 * an emulator. Returns false when the launch must wait for the user (a save
 * conflict), after sending them to the port's page to resolve it.
 */
export const prepareRecompilationCloudSave = async (
  ref: RecompilationRef
): Promise<boolean> => {
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
    WindowManager.redirectToGameWindow(
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

/**
 * Playing a port is playing the base game: it goes to the library like any
 * game the user plays, so its playtime has somewhere to land.
 */
const getOrAddBaseGame = async (ref: RecompilationRef): Promise<Game> => {
  const key = levelKeys.game(SHOP, ref.objectId);
  const existing = await gamesSublevel.get(key);
  if (existing && !existing.isDeleted) return existing;

  const title =
    existing?.title ??
    (
      await HydraApi.get<RecompilationDetails>(
        `/games/launchbox/${ref.objectId}/recompilations/${ref.slug}`,
        undefined,
        { needsAuth: false }
      ).catch(() => null)
    )?.game.title ??
    ref.slug;

  const game: Game = existing
    ? { ...existing, isDeleted: false, addedToLibraryAt: new Date() }
    : {
        title,
        iconUrl: null,
        libraryHeroImageUrl: null,
        logoImageUrl: null,
        objectId: ref.objectId,
        shop: SHOP,
        remoteId: null,
        isDeleted: false,
        playTimeInMilliseconds: 0,
        lastTimePlayed: null,
        addedToLibraryAt: new Date(),
        platform: null,
        source: "hydra",
      };
  await gamesSublevel.put(key, game);
  WindowManager.sendToAppWindows("on-library-batch-complete");
  if (HydraApi.isLoggedIn()) await createGame(game).catch(() => {});
  return game;
};

const sendPresencePing = async (baseKey: string) => {
  const game = await gamesSublevel.get(baseKey);
  if (!game) return;
  await trackGamePlaytime(game, 0, new Date()).catch((error) => {
    logger.error("Failed to send recompilation presence ping", error);
  });
};

/** Adds the session's time to the base game, as the emulator tracker does. */
const creditPlaytime = async (baseKey: string, deltaMs: number) => {
  const game = await gamesSublevel.get(baseKey);
  if (!game) return;

  const updated: Game = {
    ...game,
    playTimeInMilliseconds: (game.playTimeInMilliseconds ?? 0) + deltaMs,
    lastTimePlayed: new Date(),
  };
  await gamesSublevel.put(baseKey, updated);
  // Pages showing the base game (its reviews unlock with playtime) reload it.
  WindowManager.sendToAppWindows("on-library-batch-complete");

  const pendingDelta =
    deltaMs + (game.unsyncedDeltaPlayTimeInMilliseconds ?? 0);
  await trackGamePlaytime(updated, pendingDelta, updated.lastTimePlayed!)
    .then(() => {
      WindowManager.sendToAppWindows("on-game-session-synced");
      return gamesSublevel.put(baseKey, {
        ...updated,
        unsyncedDeltaPlayTimeInMilliseconds: 0,
      });
    })
    .catch((error) => {
      logger.error("Failed to sync recompilation playtime", error);
      return gamesSublevel.put(baseKey, {
        ...updated,
        unsyncedDeltaPlayTimeInMilliseconds: pendingDelta,
      });
    });
};

const finishSession = async (ref: RecompilationRef) => {
  const objectId = cloudSaveObjectId(ref);
  const portKey = levelKeys.game(SHOP, objectId);
  const baseKey = levelKeys.game(SHOP, ref.objectId);
  const session = sessions.get(portKey);
  if (!session) return;

  sessions.delete(portKey);
  if (session.heartbeat) clearInterval(session.heartbeat);
  deleteEmulatorGameRunning(portKey);
  deleteRecompilationGameRunning(portKey);

  const deltaMs = Math.max(0, performance.now() - session.startedAt);

  // The backup does not wait on the library: a stalled base game lookup
  // only delays the playtime, which needs the game to land on.
  const backup = hasCloudSaveLaunchGuard(objectId, SHOP)
    ? runAutomaticCloudSavePostExit(objectId, SHOP).catch((error) => {
        logger.error("Failed to sync recompilation save after exit", error);
      })
    : Promise.resolve();

  await session.baseGameReady;
  await creditPlaytime(baseKey, deltaMs).catch((error) => {
    logger.error("Failed to save recompilation playtime", error);
  });
  await backup;
};

/**
 * Tracks a running port: it counts as playing the base game (presence and
 * playtime), keeps its own cloud save from syncing mid-session, and backs
 * the save up when the port closes.
 */
export const startRecompilationSession = async (
  ref: RecompilationRef,
  child: ChildProcess
) => {
  const portKey = levelKeys.game(SHOP, cloudSaveObjectId(ref));
  const baseKey = levelKeys.game(SHOP, ref.objectId);

  // Registered before anything is awaited, so the port counts as running as
  // soon as its process starts.
  const session: RecompilationSession = {
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
  // The port's own key only blocks its cloud save mid-session; the base
  // game's key is what shows as "playing" in the app.
  setEmulatorGameRunning(portKey);
  setRecompilationGameRunning(portKey, baseKey, ref.slug);

  // Exit tracking comes before the library work, so a port that closes
  // while the base game is still being added stops counting as running.
  const finish = () => {
    if (sessions.get(portKey) !== session) return;
    void finishSession(ref);
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
  sessions.has(levelKeys.game(SHOP, cloudSaveObjectId(ref)));

/**
 * Closes a running port. Its session ends on the process exit, which still
 * saves the playtime and backs the save up.
 */
export const closeRecompilation = (ref: RecompilationRef) => {
  const session = sessions.get(levelKeys.game(SHOP, cloudSaveObjectId(ref)));
  if (!session) return false;
  return session.child.kill();
};
