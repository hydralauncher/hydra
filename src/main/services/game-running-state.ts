import { levelKeys } from "../level/sublevels/keys.js";
import type { Game } from "@types";

interface GamePlaytimeState {
  lastTick: number;
  firstTick: number;
  lastSyncTick: number;
}

export const gamesPlaytime = new Map<string, GamePlaytimeState>();

export const setGamePlaytime = (
  gameKey: string,
  playtime: GamePlaytimeState
) => {
  gamesPlaytime.set(gameKey, playtime);
};

export const isGameRunning = (objectId: string, shop: Game["shop"]) =>
  gamesPlaytime.has(levelKeys.game(shop, objectId));
