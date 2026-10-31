import { levelKeys } from "../level/sublevels/keys.js";
import type { Game, GameRunning } from "@types";

interface GamePlaytimeState {
  lastTick: number;
  firstTick: number;
  lastSyncTick: number;
  countHydraPlaytime: boolean;
  syncSteamOnExit?: boolean;
  syncEpicOnExit?: boolean;
  managedEpicSession?: boolean;
}

export const getGamePlaytimeDeltas = (
  session: GamePlaytimeState,
  now: number,
  pendingDelta = 0
) => ({
  localDelta: session.countHydraPlaytime ? now - session.lastTick : 0,
  syncDelta:
    (session.countHydraPlaytime ? now - session.lastSyncTick : 0) +
    pendingDelta,
});

const mutableGamesPlaytime = new Map<string, GamePlaytimeState>();
const emulatorGamesRunning = new Set<string>();
const trackedGamesRunningListeners = new Set<() => void>();

type TrackedGamesRunningListenerErrorReporter = (error: unknown) => void;

let reportTrackedGamesRunningListenerError: TrackedGamesRunningListenerErrorReporter =
  () => undefined;

export const setTrackedGamesRunningListenerErrorReporter = (
  reporter: TrackedGamesRunningListenerErrorReporter
) => {
  reportTrackedGamesRunningListenerError = reporter;
};

const notifyTrackedGamesRunningChange = () => {
  for (const listener of trackedGamesRunningListeners) {
    try {
      listener();
    } catch (error) {
      reportTrackedGamesRunningListenerError(error);
    }
  }
};

export const onTrackedGamesRunningChange = (listener: () => void) => {
  trackedGamesRunningListeners.add(listener);
  return () => {
    trackedGamesRunningListeners.delete(listener);
  };
};

export const hasTrackedGamesRunning = () =>
  mutableGamesPlaytime.size > 0 || emulatorGamesRunning.size > 0;

export const gamesPlaytime: ReadonlyMap<string, GamePlaytimeState> =
  mutableGamesPlaytime;

export const setGamePlaytime = (
  gameKey: string,
  playtime: GamePlaytimeState
) => {
  const isNewSession = !mutableGamesPlaytime.has(gameKey);
  mutableGamesPlaytime.set(gameKey, playtime);
  if (isNewSession) notifyTrackedGamesRunningChange();
};

export const enableHydraPlaytimeForRunningSession = (
  gameKey: string,
  now = performance.now()
) => {
  const session = mutableGamesPlaytime.get(gameKey);

  if (!session) return false;
  if (session.countHydraPlaytime) return true;

  mutableGamesPlaytime.set(gameKey, {
    ...session,
    countHydraPlaytime: true,
    lastTick: now,
    lastSyncTick: now,
  });

  return true;
};

export const deleteGamePlaytime = (gameKey: string) => {
  const deleted = mutableGamesPlaytime.delete(gameKey);
  if (deleted) notifyTrackedGamesRunningChange();
  return deleted;
};

export const resetHydraPlaytimeTicks = (
  gameKey: string,
  now = performance.now()
) => {
  const session = mutableGamesPlaytime.get(gameKey);
  if (session)
    mutableGamesPlaytime.set(gameKey, {
      ...session,
      lastTick: now,
      lastSyncTick: now,
    });
};

export const clearGamesPlaytimeState = () => {
  const hadGamesRunning = hasTrackedGamesRunning();
  mutableGamesPlaytime.clear();
  if (hadGamesRunning !== hasTrackedGamesRunning()) {
    notifyTrackedGamesRunningChange();
  }
};

export const setEmulatorGameRunning = (gameKey: string) => {
  if (emulatorGamesRunning.has(gameKey)) return;
  emulatorGamesRunning.add(gameKey);
  notifyTrackedGamesRunningChange();
};

export const deleteEmulatorGameRunning = (gameKey: string) => {
  if (emulatorGamesRunning.delete(gameKey)) notifyTrackedGamesRunningChange();
};

export const getTrackedGamesRunning = (now = performance.now()) =>
  Array.from(gamesPlaytime.entries()).map(
    ([id, session]): Pick<GameRunning, "id" | "sessionDurationInMillis"> => ({
      id,
      sessionDurationInMillis: now - session.firstTick,
    })
  );

export const isTrackedGameKeyRunning = (gameKey: string) =>
  mutableGamesPlaytime.has(gameKey) || emulatorGamesRunning.has(gameKey);

export const isGameRunning = (objectId: string, shop: Game["shop"]) =>
  isTrackedGameKeyRunning(levelKeys.game(shop, objectId));
