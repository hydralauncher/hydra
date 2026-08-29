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

export class AchievementWatcherManager {
  private static _hasFinishedPreSearch = false;

  public static get hasFinishedPreSearch() {
    return this._hasFinishedPreSearch;
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
      this.notifyCombinedAchievementsUnlocked(1, newAchievements);
    }
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
