import { promises as fs } from "node:fs";

import type { Game, SteamAchievement, UnlockedAchievement } from "@types";
import { platformToSystem } from "@shared";

import { levelKeys } from "@main/level";

import { AchievementMemoryStore } from "../achievements/achievement-memory-store";
import { getGameAchievementData } from "../achievements/get-game-achievement-data";
import { achievementsLogger } from "../logger";
import { getEmulatorConfig } from "./emulators-repository";
import {
  listRpcs3TropUsrFiles,
  matchRpcs3UnlocksToCatalogue,
  npCommIdsFromCatalogue,
  pickRpcs3TrophySets,
  readRpcs3UnlockedTrophies,
  resolveRpcs3HomeRoots,
  resolveRpcs3NpCommIds,
} from "./rpcs3-trophies";

export const RPCS3_CATALOGUE_RETRY_INTERVAL_MS = 30_000;
const nextCatalogueFetchAt = new Map<string, number>();

export interface Rpcs3TrophySources {
  homeRoots: string[];
  npCommIds: string[];
  catalogueSetIds: Record<string, string>;
}

const resolveGameDiscPaths = (game: Game, discPath?: string): string[] => [
  ...new Set(
    [
      discPath,
      game.selectedDiscPath,
      ...(game.discs ?? []).map((disc) => disc.path),
    ].filter((value): value is string => Boolean(value))
  ),
];

export const loadRpcs3TrophyCatalogue = async (
  game: Game,
  force = false
): Promise<SteamAchievement[]> => {
  const cached = AchievementMemoryStore.get(game.shop, game.objectId);
  if (cached?.achievements.length) return cached.achievements;

  const gameKey = levelKeys.game(game.shop, game.objectId);
  if (!force && Date.now() < (nextCatalogueFetchAt.get(gameKey) ?? 0)) {
    return [];
  }

  const catalogue = await getGameAchievementData(
    game.objectId,
    game.shop,
    false
  ).catch(() => []);
  if (catalogue.length) {
    nextCatalogueFetchAt.delete(gameKey);
  } else {
    nextCatalogueFetchAt.set(
      gameKey,
      Date.now() + RPCS3_CATALOGUE_RETRY_INTERVAL_MS
    );
  }
  return catalogue;
};

export const resolveRpcs3TrophySources = async (
  game: Game,
  catalogue: SteamAchievement[],
  discPath?: string
): Promise<Rpcs3TrophySources | null> => {
  if (!catalogue.length) return null;

  const config = await getEmulatorConfig("ps3");
  const homeRoots = await resolveRpcs3HomeRoots(
    config.executablePath,
    config.rpcs3ConfigRoot
  );
  if (!homeRoots.length) return null;

  const discNpCommIds = await resolveRpcs3NpCommIds(
    game,
    resolveGameDiscPaths(game, discPath),
    homeRoots
  );
  const catalogueSetIds = pickRpcs3TrophySets(
    npCommIdsFromCatalogue(catalogue),
    discNpCommIds
  );
  const npCommIds = Object.keys(catalogueSetIds);
  if (!npCommIds.length) return null;

  return { homeRoots, npCommIds, catalogueSetIds };
};

export const readRpcs3TrophySourceUnlocks = async (
  files: string[],
  sources: Rpcs3TrophySources,
  catalogue: SteamAchievement[]
): Promise<UnlockedAchievement[] | null> => {
  const unlocks = await readRpcs3UnlockedTrophies(files);
  return unlocks
    ? matchRpcs3UnlocksToCatalogue(unlocks, catalogue, sources.catalogueSetIds)
    : null;
};

const resolveGameTrophyFiles = async (game: Game) => {
  if (platformToSystem(game.platform) !== "ps3") return null;

  const catalogue = await loadRpcs3TrophyCatalogue(game);
  const sources = await resolveRpcs3TrophySources(game, catalogue);
  if (!sources) return null;

  const files = await listRpcs3TropUsrFiles(
    sources.homeRoots,
    sources.npCommIds
  );
  return { catalogue, sources, files };
};

export const readRpcs3TrophyUnlocks = async (
  game: Game
): Promise<UnlockedAchievement[]> => {
  const resolved = await resolveGameTrophyFiles(game);
  if (!resolved?.files.length) return [];

  return (
    (await readRpcs3TrophySourceUnlocks(
      resolved.files,
      resolved.sources,
      resolved.catalogue
    )) ?? []
  );
};

export const removeRpcs3TrophyFiles = async (game: Game): Promise<void> => {
  const files = (await resolveGameTrophyFiles(game))?.files ?? [];
  await Promise.all(
    files.map((file) => {
      achievementsLogger.log(`deleting ${file}`);
      return fs.rm(file, { force: true });
    })
  );
};
