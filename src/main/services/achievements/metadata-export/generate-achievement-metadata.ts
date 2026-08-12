import path from "node:path";
import fs from "node:fs";
import { randomUUID } from "node:crypto";

import type { Game, GameShop, SteamAchievement } from "@types";

import { achievementsLogger } from "../../logger";
import { HydraApi } from "../../hydra-api";
import { resolveGameExecutablePath } from "../resolve-game-executable-path";
import {
  ACHIEVEMENTS_FILE_NAME,
  STEAM_SETTINGS_DIR_NAME,
} from "../game-directory.js";
import {
  ACHIEVEMENT_IMAGES_DIR_NAME,
  buildAchievementMetadata,
  type AchievementIcon,
} from "./build-achievement-metadata";
import { findSteamSettingsDirectories } from "./find-steam-settings-directories";

const METADATA_LANGUAGE = "en";

const EXISTING_IMAGES_DIR_NAMES = [
  ACHIEVEMENT_IMAGES_DIR_NAME,
  "img",
  "achievement_images",
];

export interface AchievementMetadataExportResult {
  steamSettingsDirectories: string[];
  icons: AchievementIcon[];
}

const fetchEnglishAchievements = (
  objectId: string,
  shop: GameShop,
  signal?: AbortSignal
) =>
  HydraApi.getResponse<SteamAchievement[]>(
    `/games/${shop}/${objectId}/achievements`,
    { language: METADATA_LANGUAGE },
    { signal }
  ).then((response) => response.data ?? []);

const hasAchievementsFile = (steamSettingsDirectory: string) =>
  fs.existsSync(path.join(steamSettingsDirectory, ACHIEVEMENTS_FILE_NAME));

const findExistingImagesDirName = async (steamSettingsDirectory: string) => {
  for (const imagesDirName of EXISTING_IMAGES_DIR_NAMES) {
    const entries = await fs.promises
      .readdir(path.join(steamSettingsDirectory, imagesDirName))
      .catch(() => []);

    if (entries.length) return imagesDirName;
  }

  return null;
};

const writeAchievementsFile = async (
  steamSettingsDirectory: string,
  contents: string
) => {
  const filePath = path.join(steamSettingsDirectory, ACHIEVEMENTS_FILE_NAME);
  const temporaryFilePath = `${filePath}.${randomUUID()}.tmp`;

  try {
    await fs.promises.writeFile(temporaryFilePath, contents, {
      encoding: "utf-8",
      flag: "wx",
    });

    await fs.promises.rename(temporaryFilePath, filePath);
  } catch (error) {
    await fs.promises.rm(temporaryFilePath, { force: true }).catch(() => {});

    throw error;
  }
};

export const generateAchievementMetadata = async (
  game: Game,
  signal?: AbortSignal
): Promise<AchievementMetadataExportResult | null> => {
  if (game.shop !== "steam") return null;

  const executablePath = resolveGameExecutablePath(game);

  if (!executablePath) return null;

  const steamSettingsDirectories =
    await findSteamSettingsDirectories(executablePath);

  if (signal?.aborted) return null;

  if (!steamSettingsDirectories.length) {
    achievementsLogger.log(
      `No ${STEAM_SETTINGS_DIR_NAME} directory found for ${game.objectId} from ${executablePath}`
    );
    return null;
  }

  const directoriesMissingAchievements = steamSettingsDirectories.filter(
    (directory) => !hasAchievementsFile(directory)
  );

  const existingImagesDirNames = new Map(
    await Promise.all(
      steamSettingsDirectories.map(
        async (directory) =>
          [directory, await findExistingImagesDirName(directory)] as const
      )
    )
  );

  const directoriesMissingImages = steamSettingsDirectories.filter(
    (directory) => !existingImagesDirNames.get(directory)
  );

  if (
    !directoriesMissingAchievements.length &&
    !directoriesMissingImages.length
  ) {
    achievementsLogger.log(
      `Achievement metadata for ${game.objectId} is already present, nothing to generate`
    );
    return null;
  }

  const achievements = await fetchEnglishAchievements(
    game.objectId,
    game.shop,
    signal
  ).catch((error) => {
    if (!signal?.aborted) {
      achievementsLogger.error(
        `Failed to fetch achievement data for ${game.objectId}`,
        error
      );
    }

    return [];
  });

  if (signal?.aborted) return null;

  const defaultMetadata = buildAchievementMetadata(achievements);

  if (!defaultMetadata.entries.length) {
    achievementsLogger.log(
      `The catalogue returned no achievements for ${game.objectId}, nothing to generate`
    );
    return null;
  }

  for (const steamSettingsDirectory of directoriesMissingAchievements) {
    if (signal?.aborted) return null;

    const imagesDirName = existingImagesDirNames.get(steamSettingsDirectory);

    const { entries } = imagesDirName
      ? buildAchievementMetadata(achievements, imagesDirName)
      : defaultMetadata;

    try {
      await writeAchievementsFile(
        steamSettingsDirectory,
        JSON.stringify(entries, null, 2)
      );

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
    icons: defaultMetadata.icons.filter(({ url }) => url?.startsWith("http")),
  };
};
