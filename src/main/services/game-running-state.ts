import { levelKeys } from "../level/sublevels/keys.js";
import type { Game } from "@types";

interface GamePlaytimeState {
  lastTick: number;
  firstTick: number;
  lastSyncTick: number;
}

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
