import { levelKeys } from "@main/level";
import type { Game } from "@types";

export const gamesPlaytime = new Map<
  string,
  { lastTick: number; firstTick: number; lastSyncTick: number }
>();

export const isGameRunning = (objectId: string, shop: Game["shop"]) =>
  gamesPlaytime.has(levelKeys.game(shop, objectId));
