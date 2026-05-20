import type { ChildProcess } from "node:child_process";

import { gamesSublevel, levelKeys } from "@main/level";
import type { EmulatorSystem, Game, GameShop } from "@types";

import { createGame, trackGamePlaytime } from "../library-sync";
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
}

export const emulatorSessions = new Map<string, EmulatorSession>();

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
  };

  emulatorSessions.set(gameKey, session);

  const finalize = () => {
    if (!emulatorSessions.has(gameKey)) return;
    void finalizeEmulatorSession(gameKey);
  };

  child.once("exit", finalize);
  child.once("error", finalize);
};

const finalizeEmulatorSession = async (gameKey: string): Promise<void> => {
  const session = emulatorSessions.get(gameKey);
  if (!session) return;
  emulatorSessions.delete(gameKey);

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
  const syncPromise = game.remoteId
    ? trackGamePlaytime(updated, pendingDelta, updated.lastTimePlayed!)
    : createGame(updated);

  syncPromise
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
