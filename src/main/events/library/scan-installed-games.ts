import path from "node:path";
import fs from "node:fs";
import { t } from "i18next";
import { chunk } from "lodash-es";
import { registerEvent } from "../register-event";
import { getGameAssets } from "../catalogue/get-game-assets";
import { getDownloadsPath } from "../helpers/get-downloads-path";
import {
  isRedistributableDirectory,
  isRedistributablePath,
  rankExecutableCandidates,
  type KnownGameExecutable,
} from "@main/helpers/game-executable-ranking";
import { updateGameExecutablePath } from "@main/helpers/update-executable-path";
import { gamesSublevel, levelKeys } from "@main/level";
import { AchievementWatcherManager } from "@main/services/achievements/achievement-watcher-manager";
import { createGame } from "@main/services/library-sync";
import {
  GameExecutables,
  getSteamLibraryFolders,
  LocalNotificationManager,
  logger,
  WindowManager,
} from "@main/services";
import { runAutomaticCloudSaveSync } from "@main/services/cloud-save";
import type { Game, GameShop } from "@types";

const SCAN_DIRECTORIES = [
  String.raw`C:\Games`,
  String.raw`D:\Games`,
  String.raw`C:\Program Files (x86)\Steam\steamapps\common`,
  String.raw`C:\Program Files\Steam\steamapps\common`,
  String.raw`D:\SteamLibrary\steamapps\common`,
];

const DISCOVERED_GAMES_SHOP: GameShop = "steam";
const DISCOVERED_GAMES_CHUNK_SIZE = 4;
const UNNAMED_PATH_CANDIDATE_LIMIT = 40;
const ASSET_LOOKUP_CONCURRENCY = 8;

interface FoundGame {
  title: string;
  executablePath: string;
  iconUrl: string | null;
}

interface CancelSignal {
  cancelled: boolean;
}

const inflightScans = new Map<string, CancelSignal>();

interface AmbiguousChoice {
  objectId: string;
  title: string;
  iconUrl: string | null;
}

type ChoiceLookup =
  | { status: "found"; choice: AmbiguousChoice }
  | { status: "missing" }
  | { status: "failed" };

interface AmbiguousMatch {
  executablePath: string;
  choices: AmbiguousChoice[];
}

interface ScanResult {
  linkedGames: FoundGame[];
  addedGames: FoundGame[];
  ambiguousMatches: AmbiguousMatch[];
  total: number;
}

interface ScannedDirectory {
  directory: string;
  relativeFilePaths: string[];
  pathsByFileName: Map<string, string[]>;
}

const normalizePath = (value: string) =>
  value.replaceAll("\\", "/").toLowerCase();

const getCatalogFileNames = () => {
  const fileNames = new Set<string>();

  for (const objectId of GameExecutables.getAllObjectIds()) {
    const executables = GameExecutables.getExecutablesForGame(objectId);
    if (!executables) continue;

    for (const executable of executables) {
      fileNames.add(executable.exe.toLowerCase());
    }
  }

  return fileNames;
};

const listGameFiles = async (
  root: string,
  signal: CancelSignal
): Promise<string[]> => {
  const relativeFilePaths: string[] = [];

  const walk = async (current: string) => {
    if (signal.cancelled) return;

    const entries = await fs.promises
      .readdir(current, { withFileTypes: true })
      .catch((err) => {
        logger.error(
          `[ScanInstalledGames] Error reading folder ${current}:`,
          err
        );
        return [] as fs.Dirent[];
      });

    for (const entry of entries) {
      const entryPath = path.join(current, entry.name);

      if (entry.isDirectory()) {
        if (!isRedistributableDirectory(entry.name)) await walk(entryPath);
        continue;
      }

      if (!entry.isFile()) continue;

      const relativeFilePath = path.relative(root, entryPath);

      if (!isRedistributablePath(relativeFilePath)) {
        relativeFilePaths.push(relativeFilePath);
      }
    }
  };

  await walk(root);

  return relativeFilePaths;
};

const scanDirectory = async (
  directory: string,
  catalogFileNames: Set<string>,
  signal: CancelSignal
): Promise<ScannedDirectory> => {
  const relativeFilePaths = await listGameFiles(directory, signal);
  const pathsByFileName = new Map<string, string[]>();

  for (const relativeFilePath of relativeFilePaths) {
    const fileName = path.basename(relativeFilePath).toLowerCase();
    if (!catalogFileNames.has(fileName)) continue;

    const paths = pathsByFileName.get(fileName);

    if (paths) {
      paths.push(relativeFilePath);
    } else {
      pathsByFileName.set(fileName, [relativeFilePath]);
    }
  }

  return { directory, relativeFilePaths, pathsByFileName };
};

const isWithin = (child: string, parent: string) => {
  const relative = path.relative(parent, child);

  return (
    relative !== "" && !relative.startsWith("..") && !path.isAbsolute(relative)
  );
};

const getDefaultScanDirectories = async () => {
  const libraryFolders = await getSteamLibraryFolders().catch((err) => {
    logger.error("[ScanInstalledGames] Failed to read Steam libraries:", err);
    return [];
  });

  const downloadsPath = await getDownloadsPath().catch((err) => {
    logger.error(
      "[ScanInstalledGames] Failed to read the downloads path:",
      err
    );
    return null;
  });

  return [
    ...SCAN_DIRECTORIES,
    ...libraryFolders.map((libraryFolder) =>
      path.join(libraryFolder, "steamapps", "common")
    ),
    ...(downloadsPath ? [downloadsPath] : []),
  ];
};

const resolveScanRoots = async (directories: string[]) => {
  const resolved: string[] = [];

  for (const directory of directories) {
    const resolvedDirectory = await fs.promises
      .realpath(directory)
      .catch(() => null);

    if (resolvedDirectory && !resolved.includes(resolvedDirectory)) {
      resolved.push(resolvedDirectory);
    }
  }

  return resolved.filter(
    (directory) => !resolved.some((other) => isWithin(directory, other))
  );
};

const scanDirectories = async (
  directories: string[],
  catalogFileNames: Set<string>,
  signal: CancelSignal
): Promise<ScannedDirectory[]> => {
  const scannedDirectories: ScannedDirectory[] = [];

  for (const root of await resolveScanRoots(directories)) {
    if (signal.cancelled) break;

    scannedDirectories.push(
      await scanDirectory(root, catalogFileNames, signal)
    );
  }

  return scannedDirectories;
};

const collectCandidates = (
  executables: KnownGameExecutable[],
  pathsByFileName: Map<string, string[]>
) => {
  const candidates = new Set<string>();

  for (const executable of executables) {
    const paths = pathsByFileName.get(executable.exe.toLowerCase());
    if (!paths) continue;

    for (const candidate of paths) candidates.add(candidate);
  }

  return candidates;
};

const resolveWithinDirectory = (
  executables: KnownGameExecutable[],
  scanned: ScannedDirectory
): string | null => {
  const candidates = collectCandidates(executables, scanned.pathsByFileName);

  if (candidates.size === 0) return null;

  if (candidates.size === 1) {
    const [relativeFilePath] = candidates;
    return path.join(scanned.directory, relativeFilePath);
  }

  const match = rankExecutableCandidates(
    scanned.relativeFilePaths,
    executables,
    "library"
  );

  if (!match) {
    logger.info(
      `[ScanInstalledGames] No pick among ${[...candidates].join(", ")}`
    );
  }

  return match ? path.join(scanned.directory, match) : null;
};

const resolveExecutablePath = (
  executables: KnownGameExecutable[],
  scannedDirectories: ScannedDirectory[]
): string | null => {
  for (const scanned of scannedDirectories) {
    const executablePath = resolveWithinDirectory(executables, scanned);
    if (executablePath) return executablePath;
  }

  return null;
};

const toComparableSegments = (value: string) =>
  value
    .toLowerCase()
    .split(/[\\/]/)
    .map((segment) => segment.replaceAll(/[^a-z0-9]+/g, ""))
    .filter(Boolean);

const endsWithKnownFolder = (filePath: string, executableName: string) => {
  const pathSegments = toComparableSegments(filePath);
  const nameSegments = toComparableSegments(executableName);

  if (nameSegments.length < 2 || nameSegments.length > pathSegments.length) {
    return false;
  }

  const offset = pathSegments.length - nameSegments.length;

  return nameSegments.every(
    (segment, index) => segment === pathSegments[offset + index]
  );
};

const claimsKnownFolder = (objectId: string, executablePath: string) =>
  GameExecutables.getExecutablesForGame(objectId)?.some((executable) =>
    endsWithKnownFolder(executablePath, executable.name)
  ) ?? false;

const resolveOwner = (executablePath: string, objectIds: Set<string>) => {
  const matchingFolder = [...objectIds].filter((objectId) =>
    claimsKnownFolder(objectId, executablePath)
  );

  return matchingFolder.length === 1 ? matchingFolder[0] : null;
};

const groupObjectIdsByPath = (
  scannedDirectories: ScannedDirectory[],
  signal: CancelSignal
) => {
  const objectIdsByPath = new Map<string, Set<string>>();

  for (const objectId of GameExecutables.getAllObjectIds()) {
    if (signal.cancelled) break;

    const executables = GameExecutables.getExecutablesForGame(objectId);
    if (!executables) continue;

    const executablePath = resolveExecutablePath(
      executables,
      scannedDirectories
    );
    if (!executablePath) continue;

    const objectIds = objectIdsByPath.get(executablePath);

    if (objectIds) {
      objectIds.add(objectId);
    } else {
      objectIdsByPath.set(executablePath, new Set([objectId]));
    }
  }

  return objectIdsByPath;
};

const partitionMatches = (
  scannedDirectories: ScannedDirectory[],
  libraryObjectIds: Set<string>,
  claimedPaths: Set<string>,
  signal: CancelSignal
) => {
  const pathByObjectId = new Map<string, string>();
  const undecided: { executablePath: string; objectIds: string[] }[] = [];

  for (const [executablePath, objectIds] of groupObjectIdsByPath(
    scannedDirectories,
    signal
  )) {
    if (claimedPaths.has(normalizePath(executablePath))) {
      logger.info(
        `[ScanInstalledGames] Skipping ${executablePath}, another game already uses it`
      );
      continue;
    }

    const objectId =
      objectIds.size === 1
        ? [...objectIds][0]
        : resolveOwner(executablePath, objectIds);

    if (objectId) {
      if (libraryObjectIds.has(objectId)) {
        logger.info(
          `[ScanInstalledGames] Skipping ${executablePath}, ${objectId} is already in the library`
        );
        continue;
      }

      pathByObjectId.set(objectId, executablePath);
      continue;
    }

    const candidates = [...objectIds].sort((a, b) => Number(a) - Number(b));

    if (candidates.length > 0) {
      undecided.push({ executablePath, objectIds: candidates });
    }
  }

  return { pathByObjectId, undecided };
};

const getObjectIdsByFileName = () => {
  const objectIdsByFileName = new Map<string, string[]>();

  for (const objectId of GameExecutables.getAllObjectIds()) {
    const executables = GameExecutables.getExecutablesForGame(objectId);
    if (!executables) continue;

    for (const exe of new Set(
      executables.map((executable) => executable.exe.toLowerCase())
    )) {
      const owners = objectIdsByFileName.get(exe);

      if (owners) {
        owners.push(objectId);
      } else {
        objectIdsByFileName.set(exe, [objectId]);
      }
    }
  }

  return objectIdsByFileName;
};

const toComparableName = (value: string) =>
  value.toLowerCase().replaceAll(/[^a-z0-9]+/g, "");

const namesTheFolder = (executablePath: string, title: string) => {
  const wanted = toComparableName(title);

  return (
    !!wanted &&
    toComparableSegments(executablePath).slice(0, -1).includes(wanted)
  );
};

const installationFolderOf = (normalized: string, roots: string[]) => {
  for (const root of roots) {
    if (!normalized.startsWith(`${root}/`)) continue;

    const [folder] = normalized.slice(root.length + 1).split("/");
    return folder ? `${root}/${folder}` : null;
  }

  return null;
};

const unnamedPathsIn = (
  scanned: ScannedDirectory,
  objectIdsByFileName: Map<string, string[]>,
  libraryObjectIds: Set<string>,
  claimedPaths: Set<string>
) => {
  const unnamed: { executablePath: string; objectIds: string[] }[] = [];
  const skipped: string[] = [];

  for (const [fileName, relativeFilePaths] of scanned.pathsByFileName) {
    const objectIds = (objectIdsByFileName.get(fileName) ?? []).filter(
      (objectId) => !libraryObjectIds.has(objectId)
    );

    if (objectIds.length === 0) continue;

    if (objectIds.length > UNNAMED_PATH_CANDIDATE_LIMIT) {
      skipped.push(fileName);
      continue;
    }

    for (const relativeFilePath of relativeFilePaths) {
      const executablePath = path.join(scanned.directory, relativeFilePath);

      if (!claimedPaths.has(normalizePath(executablePath))) {
        unnamed.push({ executablePath, objectIds });
      }
    }
  }

  return { unnamed, skipped };
};

const collectUnnamedPaths = (
  scannedDirectories: ScannedDirectory[],
  libraryObjectIds: Set<string>,
  claimedPaths: Set<string>
) => {
  const objectIdsByFileName = getObjectIdsByFileName();

  const results = scannedDirectories.map((scanned) =>
    unnamedPathsIn(scanned, objectIdsByFileName, libraryObjectIds, claimedPaths)
  );

  const skipped = results.flatMap((result) => result.skipped);

  if (skipped.length > 0) {
    logger.info(
      `[ScanInstalledGames] Not naming ${skipped.length} executable names claimed by more than ${UNNAMED_PATH_CANDIDATE_LIMIT} games: ${skipped.join(", ")}`
    );
  }

  return results.flatMap((result) => result.unnamed);
};

const createLimiter = (limit: number) => {
  let active = 0;
  const waiting: (() => void)[] = [];

  const acquire = async () => {
    if (active < limit) {
      active += 1;
      return;
    }

    await new Promise<void>((resolve) => waiting.push(resolve));
  };

  const release = () => {
    const next = waiting.shift();

    if (next) {
      next();
    } else {
      active -= 1;
    }
  };

  return async <T>(task: () => Promise<T>) => {
    await acquire();

    try {
      return await task();
    } finally {
      release();
    }
  };
};

const createChoiceResolver = () => {
  const cache = new Map<string, Promise<ChoiceLookup>>();
  const limit = createLimiter(ASSET_LOOKUP_CONCURRENCY);

  return (objectId: string) => {
    const cached = cache.get(objectId);
    if (cached !== undefined) return cached;

    const pending = limit(() =>
      getGameAssets(objectId, DISCOVERED_GAMES_SHOP).catch(() =>
        getGameAssets(objectId, DISCOVERED_GAMES_SHOP)
      )
    ).then(
      (assets): ChoiceLookup =>
        assets?.title
          ? {
              status: "found",
              choice: {
                objectId,
                title: assets.title,
                iconUrl: assets.iconUrl ?? null,
              },
            }
          : { status: "missing" },
      (err): ChoiceLookup => {
        logger.error(
          `[ScanInstalledGames] Failed to fetch assets for ${objectId}:`,
          err
        );
        return { status: "failed" };
      }
    );

    cache.set(objectId, pending);
    return pending;
  };
};

const readLookups = (lookups: ChoiceLookup[]) => ({
  choices: lookups.flatMap((lookup) =>
    lookup.status === "found" ? [lookup.choice] : []
  ),
  failed: lookups.some((lookup) => lookup.status === "failed"),
});

const nameByFolder = async (
  unnamed: { executablePath: string; objectIds: string[] }[],
  resolveChoice: (objectId: string) => Promise<ChoiceLookup>,
  pathByObjectId: Map<string, string>,
  ambiguousMatches: AmbiguousMatch[]
) => {
  for (const entries of chunk(unnamed, DISCOVERED_GAMES_CHUNK_SIZE)) {
    await Promise.all(
      entries.map(async ({ executablePath, objectIds }) => {
        const { choices: named, failed } = readLookups(
          await Promise.all(objectIds.map(resolveChoice))
        );

        if (failed) {
          logger.info(
            `[ScanInstalledGames] Not naming ${executablePath}, some candidate lookups failed`
          );
          return;
        }

        const choices = named.filter((choice) =>
          namesTheFolder(executablePath, choice.title)
        );

        if (choices.length === 0) return;

        if (choices.length === 1) {
          const [choice] = choices;

          if (pathByObjectId.has(choice.objectId)) return;

          logger.info(
            `[ScanInstalledGames] ${executablePath} sits in a folder named after ${choice.title}`
          );

          pathByObjectId.set(choice.objectId, executablePath);
          return;
        }

        logger.info(
          `[ScanInstalledGames] ${executablePath} sits in a folder naming ${choices.length} games`
        );

        ambiguousMatches.push({ executablePath, choices });
      })
    );
  }
};

const findGamesOutsideLibrary = async (
  scannedDirectories: ScannedDirectory[],
  libraryObjectIds: Set<string>,
  claimedPaths: Set<string>,
  signal: CancelSignal
) => {
  const { pathByObjectId, undecided } = partitionMatches(
    scannedDirectories,
    libraryObjectIds,
    claimedPaths,
    signal
  );

  const resolveChoice = createChoiceResolver();
  const ambiguousMatches: AmbiguousMatch[] = [];

  for (const entries of chunk(undecided, DISCOVERED_GAMES_CHUNK_SIZE)) {
    await Promise.all(
      entries.map(async ({ executablePath, objectIds }) => {
        const { choices, failed } = readLookups(
          await Promise.all(objectIds.map(resolveChoice))
        );

        if (failed) {
          logger.info(
            `[ScanInstalledGames] Skipping ${executablePath}, some of its ${objectIds.length} candidate lookups failed`
          );
          return;
        }

        if (choices.length === 0) {
          logger.info(
            `[ScanInstalledGames] Skipping ${executablePath}, none of its ${objectIds.length} candidates are in the catalogue`
          );
          return;
        }

        const external = choices.filter(
          (choice) => !libraryObjectIds.has(choice.objectId)
        );

        if (external.length === 0) {
          logger.info(
            `[ScanInstalledGames] Skipping ${executablePath}, every candidate is already in the library`
          );
          return;
        }

        if (choices.length === 1) {
          const [choice] = external;

          logger.info(
            `[ScanInstalledGames] ${executablePath} resolved to ${choice.objectId}, its only candidate in the catalogue`
          );

          if (!pathByObjectId.has(choice.objectId)) {
            pathByObjectId.set(choice.objectId, executablePath);
          }

          return;
        }

        logger.info(
          `[ScanInstalledGames] ${executablePath} needs a choice between ${external.length} of ${objectIds.length} candidates`
        );

        ambiguousMatches.push({ executablePath, choices: external });
      })
    );
  }

  const takenPaths = new Set([
    ...claimedPaths,
    ...[...pathByObjectId.values()].map(normalizePath),
    ...ambiguousMatches.map((match) => normalizePath(match.executablePath)),
  ]);

  await nameByFolder(
    collectUnnamedPaths(scannedDirectories, libraryObjectIds, takenPaths),
    resolveChoice,
    pathByObjectId,
    ambiguousMatches
  );

  const roots = scannedDirectories.map((scanned) =>
    normalizePath(scanned.directory)
  );

  const occupiedFolders = new Set(
    [...claimedPaths, ...[...pathByObjectId.values()].map(normalizePath)]
      .map((claimed) => installationFolderOf(claimed, roots))
      .filter((folder) => folder !== null)
  );

  const unoccupied = ambiguousMatches.filter((match) => {
    const folder = installationFolderOf(
      normalizePath(match.executablePath),
      roots
    );

    if (!folder || !occupiedFolders.has(folder)) return true;

    logger.info(
      `[ScanInstalledGames] Not asking about ${match.executablePath}, its folder already holds a game`
    );

    return false;
  });

  unoccupied.sort((a, b) => a.executablePath.localeCompare(b.executablePath));

  return { pathByObjectId, ambiguousMatches: unoccupied };
};

export const addGameOutsideLibrary = async (
  objectId: string,
  executablePath: string
): Promise<FoundGame | null> => {
  const assets = await getGameAssets(objectId, DISCOVERED_GAMES_SHOP).catch(
    (err) => {
      logger.error(
        `[ScanInstalledGames] Failed to fetch assets for ${objectId}:`,
        err
      );
      return null;
    }
  );

  if (!assets?.title) {
    logger.info(
      `[ScanInstalledGames] Not adding ${objectId}, no title for ${executablePath}`
    );
    return null;
  }

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
  ).catch((err) => {
    logger.error(
      `[ScanInstalledGames] Failed to sync achievements for ${objectId}:`,
      err
    );
  });

  logger.info(
    `[ScanInstalledGames] Added ${objectId} to the library: ${executablePath}`
  );

  return {
    title: game.title,
    executablePath,
    iconUrl: game.iconUrl ?? null,
  };
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
        addGameOutsideLibrary(objectId, executablePath).catch((err) => {
          logger.error(
            `[ScanInstalledGames] Failed to add ${objectId} to the library:`,
            err
          );
          return null;
        })
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

const getScanNotificationKeys = (
  addedCount: number,
  linkedCount: number,
  pendingCount: number
) => {
  if (addedCount + linkedCount > 0) {
    return {
      title: "scan_games_complete_title",
      description: getScanNotificationDescriptionKey(addedCount, linkedCount),
    };
  }

  if (pendingCount > 0) {
    return {
      title: "scan_games_complete_title",
      description: "scan_games_complete_pending_description",
    };
  }

  return {
    title: "scan_games_no_results_title",
    description: "scan_games_no_results_description",
  };
};

async function publishScanNotification(
  addedCount: number,
  linkedCount: number,
  pendingCount: number
): Promise<void> {
  const keys = getScanNotificationKeys(addedCount, linkedCount, pendingCount);

  await LocalNotificationManager.createNotification(
    "SCAN_GAMES_COMPLETE",
    t(keys.title, { ns: "notifications" }),
    t(keys.description, {
      ns: "notifications",
      added: addedCount,
      linked: linkedCount,
      pending: pendingCount,
    }),
    { url: "/library?openScanModal=true" }
  );
}

const scanInstalledGames = async (
  _event: Electron.IpcMainInvokeEvent,
  additionalDirectories: string[] = [],
  includeDefaultDirectories = true,
  addGamesToLibrary = true,
  requestId?: string
): Promise<ScanResult> => {
  const signal: CancelSignal = { cancelled: false };
  if (requestId) inflightScans.set(requestId, signal);

  try {
    return await runScan(
      signal,
      additionalDirectories,
      includeDefaultDirectories,
      addGamesToLibrary
    );
  } finally {
    if (requestId) inflightScans.delete(requestId);
  }
};

const cancelScanInstalledGames = async (
  _event: Electron.IpcMainInvokeEvent,
  requestId: string
) => {
  const signal = inflightScans.get(requestId);

  if (signal) {
    signal.cancelled = true;
    logger.info(`[ScanInstalledGames] Cancelling scan ${requestId}`);
  }
};

const runScan = async (
  signal: CancelSignal,
  additionalDirectories: string[],
  includeDefaultDirectories: boolean,
  addGamesToLibrary: boolean
): Promise<ScanResult> => {
  const baseDirectories = includeDefaultDirectories
    ? await getDefaultScanDirectories()
    : [];
  const directories = [...baseDirectories, ...additionalDirectories];

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

  const scannedDirectories = await scanDirectories(
    directories,
    getCatalogFileNames(),
    signal
  );

  for (const scanned of scannedDirectories) {
    logger.info(
      `[ScanInstalledGames] Scanned ${scanned.directory}: ${scanned.relativeFilePaths.length} files, ${scanned.pathsByFileName.size} known executable names`
    );

    logger.info(
      `[ScanInstalledGames] Known executables under ${scanned.directory}: ${[...scanned.pathsByFileName.keys()].sort((a, b) => a.localeCompare(b)).join(", ")}`
    );
  }

  const linkedGames: FoundGame[] = [];
  const claimedPaths = new Set(
    games.flatMap(({ game }) =>
      game.executablePath ? [normalizePath(game.executablePath)] : []
    )
  );
  const gamesToScan = games.filter(({ game }) => !game.executablePath);

  for (const { key, game } of gamesToScan) {
    if (signal.cancelled) break;

    const executables = GameExecutables.getExecutablesForGame(game.objectId);
    if (!executables) continue;

    const foundPath = resolveExecutablePath(executables, scannedDirectories);
    if (!foundPath) continue;

    await gamesSublevel.put(key, updateGameExecutablePath(game, foundPath));
    void runAutomaticCloudSaveSync(
      game.objectId,
      game.shop,
      "environment-changed"
    );

    logger.info(
      `[ScanInstalledGames] Found executable for ${game.objectId}: ${foundPath}`
    );

    linkedGames.push({
      title: game.title,
      executablePath: foundPath,
      iconUrl: game.iconUrl ?? null,
    });
    claimedPaths.add(normalizePath(foundPath));
  }

  const libraryObjectIds = new Set(
    games
      .filter(({ game }) => game.shop === DISCOVERED_GAMES_SHOP)
      .map(({ game }) => game.objectId)
  );

  const outsideLibrary =
    addGamesToLibrary && !signal.cancelled
      ? await findGamesOutsideLibrary(
          scannedDirectories,
          libraryObjectIds,
          claimedPaths,
          signal
        )
      : {
          pathByObjectId: new Map<string, string>(),
          ambiguousMatches: [] as AmbiguousMatch[],
        };

  const addedGames = signal.cancelled
    ? []
    : await addGamesOutsideLibrary(outsideLibrary.pathByObjectId);

  logger.info(
    `[ScanInstalledGames] Linked ${linkedGames.length} of ${gamesToScan.length} games in the library, added ${addedGames.length} new ones, ${outsideLibrary.ambiguousMatches.length} need a choice`
  );

  WindowManager.sendToAppWindows("on-library-batch-complete");

  if (!signal.cancelled) {
    await publishScanNotification(
      addedGames.length,
      linkedGames.length,
      outsideLibrary.ambiguousMatches.length
    );
  }

  return {
    linkedGames,
    addedGames,
    ambiguousMatches: outsideLibrary.ambiguousMatches,
    total: gamesToScan.length,
  };
};

registerEvent("scanInstalledGames", scanInstalledGames);
registerEvent("cancelScanInstalledGames", cancelScanInstalledGames);
