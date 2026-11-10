import { promises as fs } from "node:fs";

import type { Game, UnlockedAchievement } from "@types";
import { platformToSystem } from "@shared";

import { AchievementMemoryStore } from "../achievements/achievement-memory-store";
import { getGameAchievementData } from "../achievements/get-game-achievement-data";
import { achievementsLogger } from "../logger";
import { getEmulatorConfig } from "./emulators-repository";
import {
  listRpcs3TropUsrFiles,
  npCommIdsFromAchievementIcons,
  readRpcs3UnlockedTrophies,
  resolveRpcs3HomeRoots,
  resolveRpcs3NpCommIds,
} from "./rpcs3-trophies";

export interface Rpcs3TrophySources {
  homeRoots: string[];
  npCommIds: string[];
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

const resolveCatalogueNpCommIds = async (game: Game): Promise<string[]> => {
  const catalogue =
    AchievementMemoryStore.get(game.shop, game.objectId)?.achievements ??
    (await getGameAchievementData(game.objectId, game.shop, true).catch(
      () => []
    ));
  return npCommIdsFromAchievementIcons(catalogue);
};

export const resolveRpcs3TrophySources = async (
  game: Game,
  discPath?: string
): Promise<Rpcs3TrophySources | null> => {
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
  const npCommIds = discNpCommIds.length
    ? discNpCommIds
    : await resolveCatalogueNpCommIds(game);
  if (!npCommIds.length) return null;

  return { homeRoots, npCommIds };
};

const listGameTropUsrFiles = async (game: Game): Promise<string[]> => {
  if (platformToSystem(game.platform) !== "ps3") return [];

  const sources = await resolveRpcs3TrophySources(game);
  if (!sources) return [];

  return listRpcs3TropUsrFiles(sources.homeRoots, sources.npCommIds);
};

export const readRpcs3TrophyUnlocks = async (
  game: Game
): Promise<UnlockedAchievement[]> => {
  const files = await listGameTropUsrFiles(game);
  if (!files.length) return [];

  return (await readRpcs3UnlockedTrophies(files)) ?? [];
};

export const removeRpcs3TrophyFiles = async (game: Game): Promise<void> => {
  for (const file of await listGameTropUsrFiles(game)) {
    achievementsLogger.log(`deleting ${file}`);
    await fs.rm(file, { force: true });
  }
};
