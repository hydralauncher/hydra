import path from "node:path";
import fs from "node:fs";

import type { Game, GameShop, SteamAchievement } from "@types";

import { achievementsLogger } from "../../logger";
import { HydraApi } from "../../hydra-api";
import { Wine } from "../../wine";
import {
  ACHIEVEMENT_IMAGES_DIR_NAME,
  buildAchievementMetadata,
  type AchievementIcon,
} from "./build-achievement-metadata";
import { findSteamSettingsDirectories } from "./find-steam-settings-directories";

const ACHIEVEMENTS_FILE_NAME = "achievements.json";
const METADATA_LANGUAGE = "en";

const EXISTING_IMAGES_DIR_NAMES = [ACHIEVEMENT_IMAGES_DIR_NAME, "img"];

export interface AchievementMetadataExportResult {
  steamSettingsDirectories: string[];
  icons: AchievementIcon[];
}

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

const fetchEnglishAchievements = (objectId: string, shop: GameShop) =>
  HydraApi.getResponse<SteamAchievement[]>(
    `/games/${shop}/${objectId}/achievements`,
    { language: METADATA_LANGUAGE }
  ).then((response) => response.data ?? []);

const hasAchievementsFile = (steamSettingsDirectory: string) =>
  fs.existsSync(path.join(steamSettingsDirectory, ACHIEVEMENTS_FILE_NAME));

const hasImages = async (steamSettingsDirectory: string) => {
  for (const imagesDirName of EXISTING_IMAGES_DIR_NAMES) {
    const entries = await fs.promises
      .readdir(path.join(steamSettingsDirectory, imagesDirName))
      .catch(() => []);

    if (entries.length) return true;
  }

  return false;
};

const writeAchievementsFile = async (
  steamSettingsDirectory: string,
  contents: string
) => {
  const filePath = path.join(steamSettingsDirectory, ACHIEVEMENTS_FILE_NAME);
  const temporaryFilePath = `${filePath}.tmp`;

  await fs.promises.writeFile(temporaryFilePath, contents, "utf-8");
  await fs.promises.rename(temporaryFilePath, filePath);
};

export const generateAchievementMetadata = async (
  game: Game
): Promise<AchievementMetadataExportResult | null> => {
  if (game.shop !== "steam" || !game.executablePath) return null;

  const executablePath = resolveExecutablePath(game, game.executablePath);

  const steamSettingsDirectories =
    await findSteamSettingsDirectories(executablePath);

  if (!steamSettingsDirectories.length) return null;

  const directoriesMissingAchievements = steamSettingsDirectories.filter(
    (directory) => !hasAchievementsFile(directory)
  );

  const directoriesMissingImages = (
    await Promise.all(
      steamSettingsDirectories.map(async (directory) =>
        (await hasImages(directory)) ? null : directory
      )
    )
  ).filter((directory) => directory !== null);

  if (
    !directoriesMissingAchievements.length &&
    !directoriesMissingImages.length
  )
    return null;

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

  for (const steamSettingsDirectory of directoriesMissingAchievements) {
    try {
      await writeAchievementsFile(steamSettingsDirectory, contents);

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

  return {
    steamSettingsDirectories: directoriesMissingImages,
    icons: icons.filter(({ url }) => url?.startsWith("http")),
  };
};
