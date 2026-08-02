import path from "node:path";
import fs from "node:fs";
import { t } from "i18next";
import { chunk } from "lodash-es";
import { registerEvent } from "../register-event";
import { getGameAssets } from "../catalogue/get-game-assets";
import { updateGameExecutablePath } from "@main/helpers/update-executable-path";
import { gamesSublevel, levelKeys } from "@main/level";
import { AchievementWatcherManager } from "@main/services/achievements/achievement-watcher-manager";
import { createGame } from "@main/services/library-sync";
import {
  GameExecutables,
  LocalNotificationManager,
  logger,
  WindowManager,
} from "@main/services";
import type { GameExecutableEntry } from "@main/services/game-executables";
import type { Game, GameShop } from "@types";

const SCAN_DIRECTORIES = [
  String.raw`C:\Games`,
  String.raw`D:\Games`,
  String.raw`C:\Program Files (x86)\Steam\steamapps\common`,
  String.raw`C:\Program Files\Steam\steamapps\common`,
  String.raw`C:\Program Files (x86)\DODI-Repacks`,
];

const DISCOVERED_GAMES_SHOP: GameShop = "steam";
const DISCOVERED_GAMES_CHUNK_SIZE = 4;

interface FoundGame {
  title: string;
  executablePath: string;
}

interface ScanResult {
  linkedGames: FoundGame[];
  addedGames: FoundGame[];
  total: number;
}

const collectExecutableFiles = async (
  directories: string[],
  fileNames: Set<string>
): Promise<Map<string, string[]>> => {
  const filesByName = new Map<string, string[]>();
  const visitedDirectories = new Set<string>();

  const walk = async (directory: string) => {
    let entries: fs.Dirent[];

    try {
      entries = await fs.promises.readdir(directory, { withFileTypes: true });
    } catch (err) {
      logger.error(
        `[ScanInstalledGames] Error reading folder ${directory}:`,
        err
      );
      return;
    }

    for (const entry of entries) {
      const entryPath = path.join(directory, entry.name);

      if (entry.isDirectory()) {
        await walk(entryPath);
        continue;
      }

      if (!entry.isFile()) continue;

      const fileName = entry.name.toLowerCase();
      if (!fileNames.has(fileName)) continue;

      const paths = filesByName.get(fileName);

      if (paths) {
        paths.push(entryPath);
      } else {
        filesByName.set(fileName, [entryPath]);
      }
    }
  };

  for (const directory of directories) {
    const resolvedDirectory = await fs.promises
      .realpath(directory)
      .catch(() => null);

    if (!resolvedDirectory || visitedDirectories.has(resolvedDirectory)) {
      continue;
    }

    visitedDirectories.add(resolvedDirectory);
    await walk(resolvedDirectory);
  }

  return filesByName;
};

const matchesRelativePath = (filePath: string, relativePath: string) => {
  const normalizedFilePath = filePath.replace(/\\/g, "/").toLowerCase();

  return (
    normalizedFilePath === relativePath ||
    normalizedFilePath.endsWith(`/${relativePath}`)
  );
};

const findExecutablePath = (
  entries: GameExecutableEntry[],
  filesByName: Map<string, string[]>
): string | null => {
  const entriesBySpecificity = [...entries].sort(
    (a, b) =>
      b.relativePath.split("/").length - a.relativePath.split("/").length
  );

  for (const entry of entriesBySpecificity) {
    const candidates = filesByName.get(entry.fileName);
    if (!candidates) continue;

    const match = candidates.find((candidate) =>
      matchesRelativePath(candidate, entry.relativePath)
    );

    if (match) return match;
  }

  return null;
};

interface PathMatch {
  segmentCount: number;
  objectIds: Set<string>;
}

const findGamesOutsideLibrary = (
  catalogEntries: GameExecutableEntry[],
  filesByName: Map<string, string[]>,
  libraryObjectIds: Set<string>
): Map<string, string> => {
  const matchesByPath = new Map<string, PathMatch>();

  for (const entry of catalogEntries) {
    const candidates = filesByName.get(entry.fileName);
    if (!candidates) continue;

    const segmentCount = entry.relativePath.split("/").length;

    for (const candidate of candidates) {
      if (!matchesRelativePath(candidate, entry.relativePath)) continue;

      const match = matchesByPath.get(candidate);

      if (!match || segmentCount > match.segmentCount) {
        matchesByPath.set(candidate, {
          segmentCount,
          objectIds: new Set([entry.objectId]),
        });
      } else if (segmentCount === match.segmentCount) {
        match.objectIds.add(entry.objectId);
      }
    }
  }

  const pathByObjectId = new Map<string, string>();

  for (const [candidate, match] of matchesByPath) {
    if (match.objectIds.size > 1) {
      logger.info(
        `[ScanInstalledGames] Skipping ${candidate}, it matches ${match.objectIds.size} games`
      );
      continue;
    }

    const [objectId] = match.objectIds;
    if (libraryObjectIds.has(objectId)) continue;
    if (!pathByObjectId.has(objectId)) pathByObjectId.set(objectId, candidate);
  }

  return pathByObjectId;
};

const addGameOutsideLibrary = async (
  objectId: string,
  executablePath: string
): Promise<FoundGame | null> => {
  const assets = await getGameAssets(objectId, DISCOVERED_GAMES_SHOP).catch(
    () => null
  );

  if (!assets?.title) return null;

  const gameKey = levelKeys.game(DISCOVERED_GAMES_SHOP, objectId);
  const existingGame = await gamesSublevel.get(gameKey);

  const game: Game = updateGameExecutablePath(
    {
      ...existingGame,
      title: existingGame?.title ?? assets.title,
      iconUrl: assets.iconUrl,
      libraryHeroImageUrl: assets.libraryHeroImageUrl,
      logoImageUrl: assets.logoImageUrl,
      objectId,
      shop: DISCOVERED_GAMES_SHOP,
      remoteId: existingGame?.remoteId ?? null,
      isDeleted: false,
      playTimeInMilliseconds: existingGame?.playTimeInMilliseconds ?? 0,
      lastTimePlayed: existingGame?.lastTimePlayed ?? null,
      addedToLibraryAt: existingGame?.addedToLibraryAt ?? new Date(),
      platform: existingGame?.platform ?? null,
    },
    executablePath
  );

  await gamesSublevel.put(gameKey, game);
  await createGame(game).catch(() => {});

  AchievementWatcherManager.firstSyncWithRemoteIfNeeded(
    DISCOVERED_GAMES_SHOP,
    objectId
  );

  logger.info(
    `[ScanInstalledGames] Added ${objectId} to the library: ${executablePath}`
  );

  return { title: game.title, executablePath };
};

const addGamesOutsideLibrary = async (
  pathByObjectId: Map<string, string>
): Promise<FoundGame[]> => {
  const addedGames: FoundGame[] = [];

  for (const entries of chunk(
    [...pathByObjectId],
    DISCOVERED_GAMES_CHUNK_SIZE
  )) {
    const results = await Promise.all(
      entries.map(([objectId, executablePath]) =>
        addGameOutsideLibrary(objectId, executablePath)
      )
    );

    for (const result of results) {
      if (result) addedGames.push(result);
    }
  }

  return addedGames;
};

const getScanNotificationDescriptionKey = (
  addedCount: number,
  linkedCount: number
) => {
  if (addedCount > 0 && linkedCount > 0) {
    return "scan_games_complete_added_and_linked_description";
  }

  if (addedCount > 0) return "scan_games_complete_added_description";

  return "scan_games_complete_linked_description";
};

async function publishScanNotification(
  addedCount: number,
  linkedCount: number
): Promise<void> {
  const hasResults = addedCount + linkedCount > 0;

  await LocalNotificationManager.createNotification(
    "SCAN_GAMES_COMPLETE",
    t(
      hasResults ? "scan_games_complete_title" : "scan_games_no_results_title",
      {
        ns: "notifications",
      }
    ),
    t(
      hasResults
        ? getScanNotificationDescriptionKey(addedCount, linkedCount)
        : "scan_games_no_results_description",
      { ns: "notifications", added: addedCount, linked: linkedCount }
    ),
    { url: "/library?openScanModal=true" }
  );
}

const scanInstalledGames = async (
  _event: Electron.IpcMainInvokeEvent,
  additionalDirectories: string[] = [],
  includeDefaultDirectories = true,
  addGamesToLibrary = true
): Promise<ScanResult> => {
  const baseDirectories = includeDefaultDirectories ? SCAN_DIRECTORIES : [];
  const scanDirectories = [
    ...new Set([...baseDirectories, ...additionalDirectories]),
  ];

  const games = await gamesSublevel
    .iterator()
    .all()
    .then((results) =>
      results
        .filter(
          ([_key, game]) => game.isDeleted === false && game.shop !== "custom"
        )
        .map(([key, game]) => ({ key, game }))
    );

  const catalogEntries = GameExecutables.getAllEntries();
  const catalogFileNames = new Set(
    catalogEntries.map((entry) => entry.fileName)
  );

  const filesByName = await collectExecutableFiles(
    scanDirectories,
    catalogFileNames
  );

  const linkedGames: FoundGame[] = [];
  const gamesToScan = games.filter(({ game }) => !game.executablePath);

  for (const { key, game } of gamesToScan) {
    const entries = GameExecutables.getEntriesForGame(game.objectId);
    if (entries.length === 0) continue;

    const foundPath = findExecutablePath(entries, filesByName);
    if (!foundPath) continue;

    await gamesSublevel.put(key, updateGameExecutablePath(game, foundPath));

    logger.info(
      `[ScanInstalledGames] Found executable for ${game.objectId}: ${foundPath}`
    );

    linkedGames.push({ title: game.title, executablePath: foundPath });
  }

  const libraryObjectIds = new Set(
    games
      .filter(({ game }) => game.shop === DISCOVERED_GAMES_SHOP)
      .map(({ game }) => game.objectId)
  );

  const addedGames = addGamesToLibrary
    ? await addGamesOutsideLibrary(
        findGamesOutsideLibrary(catalogEntries, filesByName, libraryObjectIds)
      )
    : [];

  WindowManager.sendToAppWindows("on-library-batch-complete");
  await publishScanNotification(addedGames.length, linkedGames.length);

  return { linkedGames, addedGames, total: gamesToScan.length };
};

registerEvent("scanInstalledGames", scanInstalledGames);
