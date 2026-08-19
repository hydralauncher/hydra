import path from "node:path";
import fs from "node:fs";
import { randomUUID } from "node:crypto";

import type {
  AchievementMetadataEntry,
  Game,
  GameShop,
  SteamAchievement,
} from "@types";

import { achievementsLogger } from "../../logger";
import { HydraApi } from "../../hydra-api";
import { resolveGameExecutablePath } from "../resolve-game-executable-path";
import {
  ACHIEVEMENTS_FILE_NAME,
  STEAM_SETTINGS_DIR_NAME,
  resolveContainedDirectory,
  resolveContainmentRoot,
} from "../game-directory.js";
import {
  ACHIEVEMENT_IMAGES_DIR_NAME,
  buildAchievementMetadata,
  buildIconsForExistingMetadata,
  getExistingEntryIconPaths,
  type AchievementIcon,
  type AchievementMetadata,
} from "./build-achievement-metadata";
import { findSteamSettingsDirectories } from "./find-steam-settings-directories";

const METADATA_LANGUAGE = "en";

const EXISTING_IMAGES_DIR_NAMES = [
  ACHIEVEMENT_IMAGES_DIR_NAME,
  "img",
  "achievement_images",
];

export interface AchievementMetadataExportTarget {
  steamSettingsDirectory: string;
  icons: AchievementIcon[];
}

export interface AchievementMetadataExportResult {
  containmentRoot: string;
  targets: AchievementMetadataExportTarget[];
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

const findExistingImagesDirName = async (steamSettingsDirectory: string) => {
  for (const imagesDirName of EXISTING_IMAGES_DIR_NAMES) {
    const entries = await fs.promises
      .readdir(path.join(steamSettingsDirectory, imagesDirName))
      .catch(() => []);

    if (entries.length) return imagesDirName;
  }

  return null;
};

const readExistingEntries = async (steamSettingsDirectory: string) => {
  try {
    const contents = await fs.promises.readFile(
      path.join(steamSettingsDirectory, ACHIEVEMENTS_FILE_NAME),
      "utf-8"
    );

    const entries = JSON.parse(contents) as AchievementMetadataEntry[];

    return Array.isArray(entries) ? entries : null;
  } catch {
    return null;
  }
};

const getReferencedIconPaths = (entries: AchievementMetadataEntry[]) =>
  entries.flatMap((entry) => {
    const { icon, icongray } = getExistingEntryIconPaths(entry);

    return [icon, icongray].filter((iconPath) => iconPath !== null);
  });

const hasEveryReferencedIcon = async (
  steamSettingsDirectory: string,
  referencedIconPaths: string[]
) => {
  const fileNamesByDirectory = new Map<string, string[]>();

  for (const iconPath of referencedIconPaths) {
    const directory = path.posix.dirname(iconPath);
    const fileNames = fileNamesByDirectory.get(directory) ?? [];

    fileNames.push(path.posix.basename(iconPath));
    fileNamesByDirectory.set(directory, fileNames);
  }

  for (const [directory, fileNames] of fileNamesByDirectory) {
    const entries = await fs.promises
      .readdir(path.join(steamSettingsDirectory, directory))
      .catch(() => null);

    if (!entries) return false;

    const presentFileNames = new Set(entries);

    if (fileNames.some((fileName) => !presentFileNames.has(fileName))) {
      return false;
    }
  }

  return true;
};

const hasCompleteImages = async (
  steamSettingsDirectory: string,
  existingEntries: AchievementMetadataEntry[] | null
) => {
  const referencedIconPaths = existingEntries
    ? getReferencedIconPaths(existingEntries)
    : [];

  if (referencedIconPaths.length) {
    return hasEveryReferencedIcon(steamSettingsDirectory, referencedIconPaths);
  }

  return (await findExistingImagesDirName(steamSettingsDirectory)) !== null;
};

const writeAchievementsFile = async (
  containmentRoot: string,
  steamSettingsDirectory: string,
  contents: string
) => {
  const resolved = await resolveContainedDirectory(
    containmentRoot,
    steamSettingsDirectory
  );

  if (!resolved) {
    throw new Error(
      `Refusing to write ${ACHIEVEMENTS_FILE_NAME}: ${steamSettingsDirectory} is outside ${containmentRoot}`
    );
  }

  const filePath = path.join(resolved, ACHIEVEMENTS_FILE_NAME);
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

interface WriteGeneratedAchievementFilesOptions {
  containmentRoot: string;
  directories: string[];
  existingImagesDirNames: Map<string, string | null>;
  achievements: SteamAchievement[];
  defaultMetadata: AchievementMetadata;
  objectId: string;
  signal?: AbortSignal;
}

const writeGeneratedAchievementFiles = async ({
  containmentRoot,
  directories,
  existingImagesDirNames,
  achievements,
  defaultMetadata,
  objectId,
  signal,
}: WriteGeneratedAchievementFilesOptions) => {
  const generatedIconsByDirectory = new Map<string, AchievementIcon[]>();

  for (const steamSettingsDirectory of directories) {
    if (signal?.aborted) return null;

    const imagesDirName = existingImagesDirNames.get(steamSettingsDirectory);

    const { entries, icons } = imagesDirName
      ? buildAchievementMetadata(achievements, imagesDirName)
      : defaultMetadata;

    generatedIconsByDirectory.set(steamSettingsDirectory, icons);

    try {
      await writeAchievementsFile(
        containmentRoot,
        steamSettingsDirectory,
        JSON.stringify(entries, null, 2)
      );

      achievementsLogger.log(
        `Generated ${ACHIEVEMENTS_FILE_NAME} for ${objectId} at ${steamSettingsDirectory}`
      );
    } catch (error) {
      achievementsLogger.error(
        `Failed to write ${ACHIEVEMENTS_FILE_NAME} at ${steamSettingsDirectory}`,
        error
      );
    }
  }

  return generatedIconsByDirectory;
};

export const generateAchievementMetadata = async (
  game: Game,
  signal?: AbortSignal
): Promise<AchievementMetadataExportResult | null> => {
  if (game.shop !== "steam") return null;

  const executablePath = resolveGameExecutablePath(game);

  if (!executablePath) return null;

  const containmentRoot = await resolveContainmentRoot(executablePath);

  if (!containmentRoot) return null;

  const steamSettingsDirectories =
    await findSteamSettingsDirectories(executablePath);

  if (signal?.aborted) return null;

  if (!steamSettingsDirectories.length) {
    achievementsLogger.log(
      `No ${STEAM_SETTINGS_DIR_NAME} directory found for ${game.objectId} from ${executablePath}`
    );
    return null;
  }

  const existingEntriesByDirectory = new Map(
    await Promise.all(
      steamSettingsDirectories.map(
        async (directory) =>
          [directory, await readExistingEntries(directory)] as const
      )
    )
  );

  const directoriesMissingAchievements = steamSettingsDirectories.filter(
    (directory) => !existingEntriesByDirectory.get(directory)
  );

  const existingImagesDirNames = new Map(
    await Promise.all(
      steamSettingsDirectories.map(
        async (directory) =>
          [directory, await findExistingImagesDirName(directory)] as const
      )
    )
  );

  const directoriesMissingImages = (
    await Promise.all(
      steamSettingsDirectories.map(async (directory) =>
        (await hasCompleteImages(
          directory,
          existingEntriesByDirectory.get(directory) ?? null
        ))
          ? null
          : directory
      )
    )
  ).filter((directory) => directory !== null);

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

  const generatedIconsByDirectory = await writeGeneratedAchievementFiles({
    containmentRoot,
    directories: directoriesMissingAchievements,
    existingImagesDirNames,
    achievements,
    defaultMetadata,
    objectId: game.objectId,
    signal,
  });

  if (!generatedIconsByDirectory) return null;

  const targets = directoriesMissingImages
    .map((steamSettingsDirectory) => {
      const existingEntries = existingEntriesByDirectory.get(
        steamSettingsDirectory
      );

      const icons = existingEntries
        ? buildIconsForExistingMetadata(achievements, existingEntries)
        : (generatedIconsByDirectory.get(steamSettingsDirectory) ??
          defaultMetadata.icons);

      return {
        steamSettingsDirectory,
        icons: icons.filter(({ url }) => url?.startsWith("http")),
      };
    })
    .filter(({ icons }) => icons.length);

  return { containmentRoot, targets };
};
