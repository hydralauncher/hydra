import { parseAchievementFile } from "./parse-achievement-file";
import { mergeAchievements } from "./merge-achievements";
import fs, { readdirSync } from "node:fs";
import { findAllAchievementFiles } from "./find-achievement-files";
import { collectGameAchievementFiles } from "./collect-game-achievement-files";
import { findNestedAchievementFiles } from "./find-nested-achievement-files";
import type {
  AchievementFile,
  Game,
  GameShop,
  UnlockedAchievement,
  UserPreferences,
} from "@types";
import { achievementsLogger } from "../logger";
import { Cracker } from "@shared";
import { publishCombinedNewAchievementNotification } from "../notifications";
import { db, gamesSublevel, levelKeys } from "@main/level";
import { setTimeout } from "node:timers/promises";
import { Wine } from "../wine";
import { AchievementMemoryStore } from "./achievement-memory-store";
import { achievementNotificationPresenter } from "../achievement-notification-presenter-electron";
import { getGameAchievementData } from "./get-game-achievement-data";
import { resolveEpicAchievementUnlocks } from "./resolve-epic-achievement-unlocks";
import {
  EpicAchievementBaselineTracker,
  type ClassifiedEpicAchievements,
} from "./epic/achievement-baseline";

const fileStats: Map<string, number> = new Map();
const fltFiles: Map<string, Set<string>> = new Map();
const processingGames = new Map<string, Promise<void>>();
const EPIC_METADATA_RETRY_MS = 60_000;
const epicMetadataRetryAt = new Map<string, number>();
const epicFirstObservedUnlocks = new Map<string, Map<string, number>>();
const epicBaselineTracker = new EpicAchievementBaselineTracker();

const withGameProcessing = async <T>(
  gameKey: string,
  task: () => Promise<T>
): Promise<T> => {
  const previous = processingGames.get(gameKey) ?? Promise.resolve();
  let release!: () => void;
  const current = new Promise<void>((resolve) => {
    release = resolve;
  });
  const tail = previous.then(() => current);
  processingGames.set(gameKey, tail);

  await previous;
  try {
    return await task();
  } finally {
    release();
    if (processingGames.get(gameKey) === tail) processingGames.delete(gameKey);
  }
};

const resolveGameAchievementUnlocks = async (
  game: Game,
  achievements: UnlockedAchievement[]
): Promise<UnlockedAchievement[]> => {
  if (game.shop !== "epic") return achievements;

  const gameKey = levelKeys.game(game.shop, game.objectId);
  if (achievements.length === 0) {
    epicMetadataRetryAt.delete(gameKey);
    return achievements;
  }
  const firstObserved =
    epicFirstObservedUnlocks.get(gameKey) ?? new Map<string, number>();
  epicFirstObservedUnlocks.set(gameKey, firstObserved);
  const observed = achievements.map((achievement) => {
    const unlockTime = Math.min(
      firstObserved.get(achievement.name) ?? achievement.unlockTime,
      achievement.unlockTime
    );
    firstObserved.set(achievement.name, unlockTime);
    return { ...achievement, unlockTime };
  });

  let definitions =
    AchievementMemoryStore.get(game.shop, game.objectId)?.achievements ?? [];
  let result = resolveEpicAchievementUnlocks(observed, definitions);
  if (result.unresolvedCount > 0) {
    const now = Date.now();
    if (now >= (epicMetadataRetryAt.get(gameKey) ?? 0)) {
      epicMetadataRetryAt.set(gameKey, now + EPIC_METADATA_RETRY_MS);
      try {
        definitions = await getGameAchievementData(
          game.objectId,
          game.shop,
          false
        );
        result = resolveEpicAchievementUnlocks(observed, definitions);
      } catch (error) {
        achievementsLogger.warn(
          "Cannot load Epic achievement definitions",
          game.objectId,
          error
        );
      }
    }
  }

  if (result.unresolvedCount === 0) epicMetadataRetryAt.delete(gameKey);
  return result.resolved;
};

const mergeDetectedAchievements = async (
  game: Game,
  achievements: UnlockedAchievement[]
) => {
  const uniqueAchievements = Array.from(
    new Map(
      achievements.map((achievement) => [
        achievement.name.toLowerCase(),
        achievement,
      ])
    ).values()
  );

  if (uniqueAchievements.length === 0) return 0;

  return mergeAchievements(game, uniqueAchievements, true);
};

const parseEpicFile = (
  gameKey: string,
  file: AchievementFile,
  initialSync: boolean
): ClassifiedEpicAchievements | null => {
  if (file.type !== "nemirtingas" && file.type !== "alan-wake-2") {
    throw new Error(`Unexpected Epic achievement source: ${file.type}`);
  }

  const observedAtMs = Date.now();
  const parsed = parseAchievementFile(file.filePath, file.type);
  const classified = epicBaselineTracker.observe(
    gameKey,
    file.filePath,
    file.type,
    parsed,
    initialSync,
    observedAtMs
  );
  if (classified === null) fileStats.set(file.filePath, -1);
  return classified;
};

const mergeEpicSnapshots = async (
  game: Game,
  snapshots: ClassifiedEpicAchievements,
  publishLive: boolean,
  sendSilentUpdate = publishLive
) => {
  const resolved = await resolveGameAchievementUnlocks(game, [
    ...snapshots.historical,
    ...snapshots.live,
  ]);
  const definitions =
    AchievementMemoryStore.get(game.shop, game.objectId)?.achievements ?? [];
  const historicalNames = new Set(
    resolveEpicAchievementUnlocks(
      snapshots.historical,
      definitions
    ).resolved.map((achievement) => achievement.name.toUpperCase())
  );
  const historical = resolved.filter((achievement) =>
    historicalNames.has(achievement.name.toUpperCase())
  );
  const live = resolved.filter(
    (achievement) => !historicalNames.has(achievement.name.toUpperCase())
  );

  const historicalCount = historical.length
    ? await mergeAchievements(game, historical, false, sendSilentUpdate)
    : 0;
  let liveCount = 0;
  if (live.length) {
    liveCount = publishLive
      ? await mergeDetectedAchievements(game, live)
      : await mergeAchievements(game, live, false);
  }

  return {
    resolvedCount: resolved.length,
    newAchievements: historicalCount + liveCount,
  };
};

const parseInitialAchievementFiles = (
  game: Game,
  gameKey: string,
  achievementFiles: AchievementFile[],
  initialSync: boolean
) => {
  const unlockedAchievements: UnlockedAchievement[] = [];
  const epicSnapshots: ClassifiedEpicAchievements = {
    historical: [],
    live: [],
  };

  for (const achievementFile of achievementFiles) {
    if (game.shop === "epic") {
      const classified = parseEpicFile(gameKey, achievementFile, initialSync);
      if (classified) {
        epicSnapshots.historical.push(...classified.historical);
        epicSnapshots.live.push(...classified.live);
      }
      continue;
    }

    const parsed = parseAchievementFile(
      achievementFile.filePath,
      achievementFile.type
    );
    if (parsed?.length) unlockedAchievements.push(...parsed);
  }

  return { unlockedAchievements, epicSnapshots };
};

const parsePreSearchAchievementFile = (
  game: Game,
  gameKey: string,
  achievementFile: AchievementFile,
  epicSnapshots: ClassifiedEpicAchievements
): UnlockedAchievement[] | null => {
  if (game.shop !== "epic") {
    return parseAchievementFile(achievementFile.filePath, achievementFile.type);
  }

  const classified = parseEpicFile(gameKey, achievementFile, true);
  if (!classified) return null;
  epicSnapshots.historical.push(...classified.historical);
  epicSnapshots.live.push(...classified.live);
  return [...classified.historical, ...classified.live];
};

const parsePreSearchAchievementFiles = (
  game: Game,
  gameKey: string,
  achievementFiles: AchievementFile[]
) => {
  const unlockedAchievements: UnlockedAchievement[] = [];
  const epicSnapshots: ClassifiedEpicAchievements = {
    historical: [],
    live: [],
  };

  for (const achievementFile of achievementFiles) {
    const parsed = parsePreSearchAchievementFile(
      game,
      gameKey,
      achievementFile,
      epicSnapshots
    );
    if (parsed === null) {
      fileStats.set(achievementFile.filePath, -1);
      continue;
    }

    try {
      fileStats.set(
        achievementFile.filePath,
        fs.statSync(achievementFile.filePath).mtimeMs
      );
    } catch {
      fileStats.set(achievementFile.filePath, -1);
    }

    if (parsed.length) {
      unlockedAchievements.push(...parsed);
      achievementsLogger.log(
        "Achievement file for",
        game.title,
        achievementFile.filePath,
        parsed
      );
    }
  }

  return { unlockedAchievements, epicSnapshots };
};

const getEnableSteamAchievements = async () => {
  const userPreferences = await db.get<string, UserPreferences | null>(
    levelKeys.userPreferences,
    {
      valueEncoding: "json",
    }
  );

  return userPreferences?.enableSteamAchievements ?? false;
};

const getWatchedGames = async (onlyWithWinePrefix = false) => {
  const games = await gamesSublevel
    .values()
    .all()
    .then((games) => games.filter((game) => !game.isDeleted));

  if (!onlyWithWinePrefix) return games;

  return games.filter(
    (game) =>
      game.shop === "epic" ||
      !!Wine.getEffectivePrefixPath(game.winePrefixPath, game.objectId)
  );
};

const watchAchievementsWindows = async () => {
  const games = await getWatchedGames();

  if (games.length === 0) return;

  const staticFilesByObjectId = findAllAchievementFiles();
  const nestedFilesByObjectId = await findNestedAchievementFiles();
  const includeSteamCache = await getEnableSteamAchievements();

  for (const game of games) {
    const gameAchievementFiles = await collectGameAchievementFiles(game, {
      includeSteamCache,
      staticFilesByObjectId,
      nestedFilesByObjectId,
    });

    await processChangedAchievementFiles(game, gameAchievementFiles);
  }
};

const watchAchievementsWithWine = async () => {
  const games = await getWatchedGames(true);

  if (games.length === 0) return;

  const includeSteamCache = await getEnableSteamAchievements();

  for (const game of games) {
    const gameAchievementFiles = await collectGameAchievementFiles(game, {
      includeSteamCache,
    });

    await processChangedAchievementFiles(game, gameAchievementFiles);
  }
};

const hasFltFolderChanged = (file: AchievementFile) => {
  try {
    const currentAchievements = new Set(readdirSync(file.filePath));
    const previousAchievements = fltFiles.get(file.filePath);

    fltFiles.set(file.filePath, currentAchievements);
    if (
      !previousAchievements ||
      currentAchievements.difference(previousAchievements).size === 0
    ) {
      return false;
    }

    achievementsLogger.log("Detected change in FLT folder", file.filePath);
    return true;
  } catch (err) {
    achievementsLogger.error(err);
    fltFiles.set(file.filePath, new Set());
    return false;
  }
};

const hasAchievementFileChanged = (file: AchievementFile) => {
  if (file.type === Cracker.flt) {
    return hasFltFolderChanged(file);
  }

  try {
    const currentStat = fs.statSync(file.filePath);
    const previousStat = fileStats.get(file.filePath);
    fileStats.set(file.filePath, currentStat.mtimeMs);

    if (previousStat === currentStat.mtimeMs) {
      return false;
    }

    const isFirstChange = previousStat === undefined || previousStat === -1;

    achievementsLogger.log(
      isFirstChange ? "First change in file" : "Detected change in file",
      file.filePath,
      previousStat,
      currentStat.mtimeMs
    );

    return true;
  } catch (err) {
    achievementsLogger.error(
      "Error reading file",
      file.filePath,
      err instanceof Error ? err.message : err
    );
    fileStats.set(file.filePath, -1);
    return false;
  }
};

const processChangedAchievementFiles = async (
  game: Game,
  achievementFiles: AchievementFile[]
) => {
  const gameKey = levelKeys.game(game.shop, game.objectId);

  if (processingGames.has(gameKey)) return 0;

  return withGameProcessing(gameKey, async () => {
    const changedFiles = achievementFiles.filter(hasAchievementFileChanged);
    const retryEpicMetadata =
      game.shop === "epic" &&
      Date.now() >= (epicMetadataRetryAt.get(gameKey) ?? Infinity);

    if (!changedFiles.length && !retryEpicMetadata) return 0;

    const filesToParse = game.shop === "epic" ? achievementFiles : changedFiles;
    const parsedAchievements: UnlockedAchievement[] = [];
    const epicSnapshots: ClassifiedEpicAchievements = {
      historical: [],
      live: [],
    };
    for (const file of filesToParse) {
      if (game.shop === "epic") {
        const classified = parseEpicFile(gameKey, file, false);
        if (classified) {
          epicSnapshots.historical.push(...classified.historical);
          epicSnapshots.live.push(...classified.live);
        }
        continue;
      }

      const parsed = parseAchievementFile(file.filePath, file.type);
      if (parsed === null) {
        fileStats.set(file.filePath, -1);
        continue;
      }
      parsedAchievements.push(...parsed);
    }
    if (game.shop === "epic") {
      return (await mergeEpicSnapshots(game, epicSnapshots, true))
        .newAchievements;
    }

    return mergeDetectedAchievements(game, parsedAchievements);
  });
};

export class AchievementWatcherManager {
  private static _hasFinishedPreSearch = false;

  public static get hasFinishedPreSearch() {
    return this._hasFinishedPreSearch;
  }

  public static readonly alreadySyncedGames: Map<string, boolean> = new Map();

  public static resetSessionState() {
    this.alreadySyncedGames.clear();
    AchievementMemoryStore.clear();
    epicMetadataRetryAt.clear();
    epicFirstObservedUnlocks.clear();
    epicBaselineTracker.clear();
  }

  public static forgetAchievementFiles(gameKey: string, filePaths: string[]) {
    this.alreadySyncedGames.delete(gameKey);
    epicMetadataRetryAt.delete(gameKey);
    epicFirstObservedUnlocks.delete(gameKey);
    epicBaselineTracker.markReset(gameKey, filePaths);

    for (const filePath of filePaths) {
      fileStats.delete(filePath);
      fltFiles.delete(filePath);
    }
  }

  public static async syncGameAchievementFiles(
    shop: GameShop,
    objectId: string
  ) {
    this.alreadySyncedGames.delete(levelKeys.game(shop, objectId));

    return this.firstSyncWithRemoteIfNeeded(shop, objectId);
  }

  public static async firstSyncWithRemoteIfNeeded(
    shop: GameShop,
    objectId: string
  ) {
    if (shop === "custom") return;

    const gameKey = levelKeys.game(shop, objectId);
    if (this.alreadySyncedGames.get(gameKey)) return;

    this.alreadySyncedGames.set(gameKey, true);

    const game = await gamesSublevel.get(gameKey).catch(() => null);
    if (!game || game.isDeleted) return;

    const gameAchievementFiles = await collectGameAchievementFiles(game, {
      includeSteamCache: await getEnableSteamAchievements(),
      awaitGameDirectoryLocations: true,
    });

    return withGameProcessing(gameKey, async () => {
      const { unlockedAchievements, epicSnapshots } =
        parseInitialAchievementFiles(
          game,
          gameKey,
          gameAchievementFiles,
          !this.hasFinishedPreSearch
        );

      let newAchievements: number;
      try {
        if (game.shop === "epic") {
          const merged = await mergeEpicSnapshots(
            game,
            epicSnapshots,
            this.hasFinishedPreSearch,
            false
          );
          newAchievements = merged.newAchievements;
          if (merged.resolvedCount === 0) {
            await mergeAchievements(game, [], false);
          }
        } else {
          newAchievements = await mergeAchievements(
            game,
            unlockedAchievements,
            false
          );
        }
      } catch (error) {
        this.alreadySyncedGames.delete(gameKey);
        throw error;
      }

      if (!game.remoteId) {
        this.alreadySyncedGames.delete(gameKey);
      }

      if (
        newAchievements > 0 &&
        this.hasFinishedPreSearch &&
        game.shop !== "epic"
      ) {
        this.notifyCombinedAchievementsUnlocked(1, newAchievements);
      }
    });
  }

  public static watchAchievements() {
    if (!this.hasFinishedPreSearch) return;

    if (process.platform === "win32") {
      return watchAchievementsWindows();
    }

    return watchAchievementsWithWine();
  }

  private static async preProcessGameAchievementFiles(
    game: Game,
    gameAchievementFiles: AchievementFile[]
  ) {
    const gameKey = levelKeys.game(game.shop, game.objectId);
    return withGameProcessing(gameKey, async () => {
      const { unlockedAchievements, epicSnapshots } =
        parsePreSearchAchievementFiles(game, gameKey, gameAchievementFiles);

      if (game.shop === "epic") {
        const merged = await mergeEpicSnapshots(
          game,
          epicSnapshots,
          false,
          false
        );
        if (merged.resolvedCount === 0) {
          return { newAchievements: 0, isRemoteBehind: false };
        }
      } else {
        const resolvedAchievements = await resolveGameAchievementUnlocks(
          game,
          unlockedAchievements
        );
        if (!resolvedAchievements.length) {
          return { newAchievements: 0, isRemoteBehind: false };
        }
        await mergeAchievements(game, resolvedAchievements, false);
      }

      const mergedAchievementCount =
        AchievementMemoryStore.get(game.shop, game.objectId)
          ?.unlockedAchievements.length ?? 0;

      const remoteAchievementCount = game.unlockedAchievementCount ?? 0;
      const alreadyReportedCount = Math.max(
        remoteAchievementCount,
        game.reportedUnlockedAchievementCount ?? 0
      );

      await this.persistReportedAchievementCount(game, mergedAchievementCount);

      return {
        newAchievements: Math.max(
          0,
          mergedAchievementCount - alreadyReportedCount
        ),
        isRemoteBehind: mergedAchievementCount > remoteAchievementCount,
      };
    });
  }

  private static async persistReportedAchievementCount(
    game: Game,
    unlockedAchievementCount: number
  ) {
    const gameKey = levelKeys.game(game.shop, game.objectId);
    const currentGame = await gamesSublevel.get(gameKey).catch(() => null);

    if (
      !currentGame ||
      currentGame.reportedUnlockedAchievementCount === unlockedAchievementCount
    ) {
      return;
    }

    await gamesSublevel
      .put(gameKey, {
        ...currentGame,
        reportedUnlockedAchievementCount: unlockedAchievementCount,
      })
      .catch((err) =>
        achievementsLogger.error(
          "Failed to persist reported achievement count",
          game.objectId,
          game.title,
          err
        )
      );
  }

  private static async getGameAchievementFiles() {
    const games = await getWatchedGames();

    const includeSteamCache = await getEnableSteamAchievements();

    const isWindows = process.platform === "win32";

    const staticFilesByObjectId = isWindows
      ? findAllAchievementFiles()
      : undefined;

    const nestedFilesByObjectId = isWindows
      ? await findNestedAchievementFiles()
      : undefined;

    return Promise.all(
      games.map(async (game) => ({
        game,
        achievementFiles: await collectGameAchievementFiles(game, {
          includeSteamCache,
          staticFilesByObjectId,
          nestedFilesByObjectId,
          awaitGameDirectoryLocations: true,
        }),
      }))
    );
  }

  private static async notifyCombinedAchievementsUnlocked(
    totalNewGamesWithAchievements: number,
    totalNewAchievements: number
  ) {
    const userPreferences = await db.get<string, UserPreferences>(
      levelKeys.userPreferences,
      {
        valueEncoding: "json",
      }
    );

    const shouldUseCustomNotification =
      userPreferences.achievementNotificationsEnabled !== false &&
      userPreferences.achievementCustomNotificationsEnabled !== false &&
      process.platform === "win32";

    if (shouldUseCustomNotification) {
      achievementNotificationPresenter.enqueueCombined(
        userPreferences.achievementCustomNotificationPosition ?? "top-left",
        totalNewGamesWithAchievements,
        totalNewAchievements
      );
    } else {
      publishCombinedNewAchievementNotification(
        totalNewAchievements,
        totalNewGamesWithAchievements
      );
    }
  }

  public static async preSearchAchievements() {
    try {
      const gameAchievementFiles = await this.getGameAchievementFiles();

      const preProcessResults = await Promise.all(
        gameAchievementFiles.map(({ game, achievementFiles }) => {
          return this.preProcessGameAchievementFiles(game, achievementFiles);
        })
      );

      const totalNewGamesWithAchievements = preProcessResults.filter(
        (result) => result.newAchievements > 0
      ).length;

      const totalNewAchievements = preProcessResults.reduce(
        (acc, result) => acc + result.newAchievements,
        0
      );

      this._hasFinishedPreSearch = true;

      await this.uploadPreSearchAchievements(
        gameAchievementFiles.filter(
          (_, index) => preProcessResults[index].isRemoteBehind
        )
      );

      if (totalNewAchievements > 0) {
        await setTimeout(4000);
        this.notifyCombinedAchievementsUnlocked(
          totalNewGamesWithAchievements,
          totalNewAchievements
        );
      }
    } catch (err) {
      achievementsLogger.error("Error on preSearchAchievements", err);
    }

    this._hasFinishedPreSearch = true;
  }

  private static async uploadPreSearchAchievements(
    gamesWithNewAchievements: { game: Game }[]
  ) {
    for (const { game } of gamesWithNewAchievements) {
      if (!game.remoteId) continue;

      await mergeAchievements(game, [], false).catch((err) =>
        achievementsLogger.error(
          "Failed to upload achievements found on startup",
          game.objectId,
          game.title,
          err
        )
      );
    }
  }
}
