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
import { HydraApi } from "../hydra-api";
import {
  hasTouchedAchievementBatchGames,
  setAchievementBatchActive,
  takeTouchedAchievementBatchGames,
  trackAchievementBatchGame,
} from "./achievement-batch-games";
import { Cracker } from "@shared";
import { publishCombinedNewAchievementNotification } from "../notifications";
import { db, gamesSublevel, levelKeys } from "@main/level";
import { setTimeout } from "node:timers/promises";
import { Wine } from "../wine";
import { AchievementMemoryStore } from "./achievement-memory-store";
import { achievementNotificationPresenter } from "../achievement-notification-presenter-electron";

const fileStats: Map<string, number> = new Map();
const fltFiles: Map<string, Set<string>> = new Map();
const processingGameKeys = new Set<string>();

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
    (game) => !!Wine.getEffectivePrefixPath(game.winePrefixPath, game.objectId)
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

  if (processingGameKeys.has(gameKey)) return 0;
  processingGameKeys.add(gameKey);

  try {
    const changedFiles = achievementFiles.filter(hasAchievementFileChanged);

    if (!changedFiles.length) return 0;

    const unlockedAchievements = changedFiles.flatMap((file) =>
      parseAchievementFile(file.filePath, file.type)
    );

    return mergeDetectedAchievements(game, unlockedAchievements);
  } finally {
    processingGameKeys.delete(gameKey);
  }
};

const hasUnmergedUnlocks = (game: Game, files: AchievementFile[]) => {
  const mergedNames = new Set(
    (
      AchievementMemoryStore.get(game.shop, game.objectId)
        ?.unlockedAchievements ?? []
    ).map((achievement) => achievement.name.toUpperCase())
  );

  return files.some((file) =>
    parseAchievementFile(file.filePath, file.type).some(
      (achievement) => !mergedNames.has(achievement.name.toUpperCase())
    )
  );
};

const BATCH_SYNC_CONCURRENCY = 4;

export class AchievementWatcherManager {
  private static _hasFinishedPreSearch = false;
  private static batchDepth = 0;
  private static hasPendingBatchSync = false;
  private static readonly batchNotificationCounts = new Map<string, number>();
  private static readonly batchGames = new Map<
    string,
    { shop: GameShop; objectId: string }
  >();

  public static get hasFinishedPreSearch() {
    return this._hasFinishedPreSearch;
  }

  public static get isBatching() {
    return this.batchDepth > 0;
  }

  public static trackBatchGame(shop: GameShop, objectId: string) {
    const gameKey = levelKeys.game(shop, objectId);
    this.batchGames.set(gameKey, { shop, objectId });
    trackAchievementBatchGame(gameKey);
  }

  public static readonly alreadySyncedGames: Map<string, boolean> = new Map();

  public static resetSessionState() {
    this.alreadySyncedGames.clear();
    AchievementMemoryStore.clear();
  }

  public static forgetAchievementFiles(gameKey: string, filePaths: string[]) {
    this.alreadySyncedGames.delete(gameKey);

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

    const unlockedAchievements: UnlockedAchievement[] = [];

    for (const achievementFile of gameAchievementFiles) {
      const localAchievementFile = parseAchievementFile(
        achievementFile.filePath,
        achievementFile.type
      );

      if (localAchievementFile.length) {
        unlockedAchievements.push(...localAchievementFile);
      }
    }

    let newAchievements: number;
    try {
      newAchievements = await mergeAchievements(
        game,
        unlockedAchievements,
        false
      );
    } catch (error) {
      this.alreadySyncedGames.delete(gameKey);
      throw error;
    }

    if (!game.remoteId) {
      this.alreadySyncedGames.delete(gameKey);
    }

    if (newAchievements > 0 && this.hasFinishedPreSearch) {
      if (this.batchDepth > 0) {
        this.addToBatchNotification(gameKey, newAchievements);
      } else {
        this.notifyCombinedAchievementsUnlocked(1, newAchievements);
      }
    }
  }

  private static addToBatchNotification(
    gameKey: string,
    newAchievements: number
  ) {
    this.batchNotificationCounts.set(
      gameKey,
      Math.max(this.batchNotificationCounts.get(gameKey) ?? 0, newAchievements)
    );
  }

  private static takeBatchNotification() {
    const counts = [...this.batchNotificationCounts.values()];
    this.batchNotificationCounts.clear();

    return {
      totalNewGamesWithAchievements: counts.length,
      totalNewAchievements: counts.reduce((total, count) => total + count, 0),
    };
  }

  private static async notifyBatchAchievements({
    totalNewGamesWithAchievements,
    totalNewAchievements,
  }: ReturnType<typeof AchievementWatcherManager.takeBatchNotification>) {
    if (totalNewAchievements > 0) {
      await this.notifyCombinedAchievementsUnlocked(
        totalNewGamesWithAchievements,
        totalNewAchievements
      );
    }
  }

  public static async runBatch<T>(task: () => Promise<T>): Promise<T> {
    this.batchDepth += 1;
    setAchievementBatchActive(true);

    try {
      return await task();
    } finally {
      if (this.batchDepth > 1) {
        this.hasPendingBatchSync = true;
        this.batchDepth -= 1;
      } else {
        do {
          this.hasPendingBatchSync = false;
          await this.syncUnseenAchievementFiles().catch((err) =>
            achievementsLogger.error("Error syncing batch achievements", err)
          );
          await this.syncBatchGames();
        } while (
          this.hasPendingBatchSync ||
          this.batchGames.size > 0 ||
          hasTouchedAchievementBatchGames()
        );

        const batchNotification = this.takeBatchNotification();
        this.batchDepth -= 1;
        setAchievementBatchActive(false);

        await this.notifyBatchAchievements(batchNotification).catch((err) =>
          achievementsLogger.error("Error notifying batch achievements", err)
        );
      }
    }
  }

  private static async syncBatchGames() {
    const games = [...this.batchGames.values()];
    this.batchGames.clear();

    for (let index = 0; index < games.length; index += BATCH_SYNC_CONCURRENCY) {
      await Promise.all(
        games
          .slice(index, index + BATCH_SYNC_CONCURRENCY)
          .map(({ shop, objectId }) =>
            this.firstSyncWithRemoteIfNeeded(shop, objectId).catch((err) =>
              achievementsLogger.error(
                "Error syncing batch game achievements",
                objectId,
                err
              )
            )
          )
      );
    }
  }

  private static async syncUnseenAchievementFiles() {
    const touchedGameKeys = takeTouchedAchievementBatchGames();
    if (touchedGameKeys.size === 0 || !HydraApi.isLoggedIn()) return;

    const pendingGames = (
      await this.getGameAchievementFiles(touchedGameKeys)
    ).filter(({ game, achievementFiles }) =>
      hasUnmergedUnlocks(game, achievementFiles)
    );
    if (pendingGames.length === 0) return;

    const results = await Promise.all(
      pendingGames.map(({ game, achievementFiles }) =>
        this.preProcessGameAchievementFiles(game, achievementFiles)
      )
    );

    await this.uploadPreSearchAchievements(
      pendingGames.filter((_, index) => results[index].isRemoteBehind)
    );

    let totalNewAchievements = 0;

    pendingGames.forEach(({ game }, index) => {
      const { newAchievements } = results[index];
      if (newAchievements <= 0) return;

      totalNewAchievements += newAchievements;
      this.addToBatchNotification(
        levelKeys.game(game.shop, game.objectId),
        newAchievements
      );
    });

    achievementsLogger.log(
      "Batch achievements synced",
      pendingGames.length,
      "games,",
      totalNewAchievements,
      "new achievements"
    );
  }

  public static watchAchievements() {
    if (!this.hasFinishedPreSearch || this.batchDepth > 0) return;

    if (process.platform === "win32") {
      return watchAchievementsWindows();
    }

    return watchAchievementsWithWine();
  }

  private static async preProcessGameAchievementFiles(
    game: Game,
    gameAchievementFiles: AchievementFile[]
  ) {
    const unlockedAchievements: UnlockedAchievement[] = [];
    for (const achievementFile of gameAchievementFiles) {
      const parsedAchievements = parseAchievementFile(
        achievementFile.filePath,
        achievementFile.type
      );

      try {
        const currentStat = fs.statSync(achievementFile.filePath);
        fileStats.set(achievementFile.filePath, currentStat.mtimeMs);
      } catch {
        fileStats.set(achievementFile.filePath, -1);
      }

      if (parsedAchievements.length) {
        unlockedAchievements.push(...parsedAchievements);

        achievementsLogger.log(
          "Achievement file for",
          game.title,
          achievementFile.filePath,
          parsedAchievements
        );
      }
    }

    if (!unlockedAchievements.length) {
      return { newAchievements: 0, isRemoteBehind: false };
    }

    await mergeAchievements(game, unlockedAchievements, false);

    const mergedAchievementCount =
      AchievementMemoryStore.get(game.shop, game.objectId)?.unlockedAchievements
        .length ?? 0;

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

  private static async getGameAchievementFiles(gameKeys?: Set<string>) {
    const games = (await getWatchedGames()).filter(
      (game) =>
        !gameKeys || gameKeys.has(levelKeys.game(game.shop, game.objectId))
    );

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
