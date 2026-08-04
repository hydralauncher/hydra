import path from "node:path";
import fs from "node:fs";

import type { Game, GameShop, SteamAchievement } from "@types";

import { achievementsLogger } from "../../logger";
import { HydraApi } from "../../hydra-api";
import { Wine } from "../../wine";
import {
  buildAchievementMetadata,
  type AchievementIcon,
} from "./build-achievement-metadata";
import { findSteamSettingsDirectories } from "./find-steam-settings-directories";

const ACHIEVEMENTS_FILE_NAME = "achievements.json";

// The emulators read a single string per field, so the export is always english
const METADATA_LANGUAGE = "en";

export interface AchievementMetadataExportResult {
  steamSettingsDirectories: string[];
  icons: AchievementIcon[];
}

/**
 * Wine games store the windows side path, so it has to be resolved against the
 * prefix. Games added by hand may already hold a native path, in which case the
 * prefixed path simply does not exist.
 */
const resolveExecutablePath = (game: Game, executablePath: string) => {
  const effectiveWinePrefixPath = Wine.getEffectivePrefixPath(
    game.winePrefixPath,
    game.objectId
  );

  if (!effectiveWinePrefixPath) return executablePath;

  const prefixedExecutablePath = path.join(
    effectiveWinePrefixPath,
    executablePath
  );

  return fs.existsSync(prefixedExecutablePath)
    ? prefixedExecutablePath
    : executablePath;
};

/**
 * Deliberately bypasses `getGameAchievementData`: that one follows the user
 * interface language and caches by it, and writing english into that cache
 * would change what the achievements page shows.
 */
const fetchEnglishAchievements = (objectId: string, shop: GameShop) =>
  HydraApi.getResponse<SteamAchievement[]>(
    `/games/${shop}/${objectId}/achievements`,
    { language: METADATA_LANGUAGE }
  ).then((response) => response.data ?? []);

const writeAchievementsFile = async (
  steamSettingsDirectory: string,
  contents: string
) => {
  const filePath = path.join(steamSettingsDirectory, ACHIEVEMENTS_FILE_NAME);
  const temporaryFilePath = `${filePath}.tmp`;

  await fs.promises.writeFile(temporaryFilePath, contents, "utf-8");
  await fs.promises.rename(temporaryFilePath, filePath);
};

/**
 * Steam emulators only record unlocks for achievements declared in
 * `steam_settings/achievements.json`, and repacks frequently ship without it.
 * When the emulator is present but that file is missing, generate it from the
 * catalogue so the achievements Hydra already knows how to read get written in
 * the first place.
 *
 * An existing file is never overwritten: it may carry stat and progress
 * definitions the catalogue cannot reproduce.
 */
export const generateAchievementMetadata = async (
  game: Game
): Promise<AchievementMetadataExportResult | null> => {
  if (game.shop !== "steam" || !game.executablePath) return null;

  const executablePath = resolveExecutablePath(game, game.executablePath);

  const steamSettingsDirectories = (
    await findSteamSettingsDirectories(executablePath)
  ).filter(
    (directory) => !fs.existsSync(path.join(directory, ACHIEVEMENTS_FILE_NAME))
  );

  if (!steamSettingsDirectories.length) return null;

  const achievements = await fetchEnglishAchievements(
    game.objectId,
    game.shop
  ).catch((error) => {
    achievementsLogger.error(
      `Failed to fetch achievement data for ${game.objectId}`,
      error
    );

    return [];
  });

  const { entries, icons } = buildAchievementMetadata(achievements);

  if (!entries.length) return null;

  const contents = JSON.stringify(entries, null, 2);

  const writtenDirectories: string[] = [];

  for (const steamSettingsDirectory of steamSettingsDirectories) {
    try {
      await writeAchievementsFile(steamSettingsDirectory, contents);
      writtenDirectories.push(steamSettingsDirectory);

      achievementsLogger.log(
        `Generated ${ACHIEVEMENTS_FILE_NAME} for ${game.objectId} at ${steamSettingsDirectory}`
      );
    } catch (error) {
      achievementsLogger.error(
        `Failed to write ${ACHIEVEMENTS_FILE_NAME} at ${steamSettingsDirectory}`,
        error
      );
    }
  }

  if (!writtenDirectories.length) return null;

  return {
    steamSettingsDirectories: writtenDirectories,
    icons: icons.filter(({ url }) => url?.startsWith("http")),
  };
};
