import { levelKeys } from "../level/sublevels/keys.js";
import type { Game } from "@types";

interface GamePlaytimeState {
  lastTick: number;
  firstTick: number;
  lastSyncTick: number;
  countHydraPlaytime: boolean;
  syncSteamOnExit?: boolean;
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

export const gamesPlaytime: ReadonlyMap<string, GamePlaytimeState> =
  mutableGamesPlaytime;

export const setGamePlaytime = (
  gameKey: string,
  playtime: GamePlaytimeState
) => {
  mutableGamesPlaytime.set(gameKey, playtime);
};

export const deleteGamePlaytime = (gameKey: string) =>
  mutableGamesPlaytime.delete(gameKey);

export const clearGamesPlaytimeState = () => {
  mutableGamesPlaytime.clear();
};

export const isGameRunning = (objectId: string, shop: Game["shop"]) =>
  gamesPlaytime.has(levelKeys.game(shop, objectId));
