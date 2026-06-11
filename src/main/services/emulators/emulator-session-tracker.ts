import type { ChildProcess } from "node:child_process";

import { gamesSublevel, levelKeys } from "@main/level";
import type { EmulatorSystem, Game, GameShop } from "@types";

import { trackGamePlaytime } from "../library-sync";
import { logger } from "../logger";
import { readEmulatorPlaytimeSeconds } from "./playtime-files";

export interface EmulatorSession {
  shop: GameShop;
  objectId: string;
  system: EmulatorSystem;
  executablePath: string;
  sku: string | null;
  beforeTotalSeconds: number | null;
  startedAt: number;
  heartbeat: ReturnType<typeof setInterval> | null;
  child: ChildProcess;
}

export const emulatorSessions = new Map<string, EmulatorSession>();

const PRESENCE_HEARTBEAT_INTERVAL_MS = 60_000;

const sendPresencePing = async (gameKey: string): Promise<void> => {
  const game = await gamesSublevel.get(gameKey);
  if (!game || game.shop === "custom") return;

  await trackGamePlaytime(game, 0, new Date()).catch((error) => {
    logger.error("Failed to send emulator presence ping", error);
  });
};

interface StartEmulatorSessionOptions {
  game: Game;
  system: EmulatorSystem;
  executablePath: string;
  sku: string | null;
  child: ChildProcess;
}

export const startEmulatorSession = async ({
  game,
  system,
  executablePath,
  sku,
  child,
}: StartEmulatorSessionOptions): Promise<void> => {
  const gameKey = levelKeys.game(game.shop, game.objectId);

  const before = sku
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
  };

  emulatorSessions.set(gameKey, session);

  if (game.shop !== "custom") {
    void sendPresencePing(gameKey);
    session.heartbeat = setInterval(() => {
      void sendPresencePing(gameKey);
    }, PRESENCE_HEARTBEAT_INTERVAL_MS);
    session.heartbeat.unref?.();
  }

  const finalize = () => {
    if (!emulatorSessions.has(gameKey)) return;
    void finalizeEmulatorSession(gameKey);
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

const finalizeEmulatorSession = async (gameKey: string): Promise<void> => {
  const session = emulatorSessions.get(gameKey);
  if (!session) return;
  emulatorSessions.delete(gameKey);
  if (session.heartbeat) clearInterval(session.heartbeat);

  const game = await gamesSublevel.get(gameKey);
  if (!game) return;

  let deltaSeconds = 0;
  if (session.sku) {
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

  if (deltaSeconds <= 0) {
    deltaSeconds = Math.max(0, (performance.now() - session.startedAt) / 1000);
  }

  const deltaMs = deltaSeconds * 1000;
  const updated: Game = {
    ...game,
    playTimeInMilliseconds: (game.playTimeInMilliseconds ?? 0) + deltaMs,
    lastTimePlayed: new Date(),
  };

  await gamesSublevel.put(gameKey, updated);

  if (game.shop === "custom") return;

  const pendingDelta =
    deltaMs + (game.unsyncedDeltaPlayTimeInMilliseconds ?? 0);

  trackGamePlaytime(updated, pendingDelta, updated.lastTimePlayed!)
    .then(() =>
      gamesSublevel.put(gameKey, {
        ...updated,
        unsyncedDeltaPlayTimeInMilliseconds: 0,
      })
    )
    .catch((error) => {
      logger.error("Failed to sync emulator playtime", error);
      return gamesSublevel.put(gameKey, {
        ...updated,
        unsyncedDeltaPlayTimeInMilliseconds: pendingDelta,
      });
    });
};
