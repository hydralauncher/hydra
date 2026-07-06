import { t } from "i18next";
import { registerEvent } from "../register-event";
import { getGameAssets } from "../catalogue/get-game-assets";
import { gamesSublevel, levelKeys } from "@main/level";
import { createGame } from "@main/services/library-sync";
import { AchievementWatcherManager } from "@main/services/achievements/achievement-watcher-manager";
import {
  getInstalledSteamGames,
  syncSteamPlaytimeForLibrary,
  LocalNotificationManager,
  logger,
  WindowManager,
} from "@main/services";

interface ImportedSteamGame {
  objectId: string;
  title: string;
}

export interface SteamImportResult {
  importedGames: ImportedSteamGame[];
  totalInstalled: number;
}

const importSteamGames = async (): Promise<SteamImportResult> => {
  const installedGames = await getInstalledSteamGames();
  const importedGames: ImportedSteamGame[] = [];

  for (const installedGame of installedGames) {
    const gameKey = levelKeys.game("steam", installedGame.objectId);
    const existingGame = await gamesSublevel.get(gameKey);

    if (existingGame) {
      if (existingGame.isDeleted || !existingGame.launchThroughSteam) {
        await gamesSublevel.put(gameKey, {
          ...existingGame,
          isDeleted: false,
          launchThroughSteam: true,
          addedToLibraryAt: existingGame.addedToLibraryAt ?? new Date(),
        });
      }

      AchievementWatcherManager.firstSyncWithRemoteIfNeeded(
        "steam",
        installedGame.objectId
      );
      continue;
    }

    const gameAssets = await getGameAssets(
      installedGame.objectId,
      "steam"
    ).catch(() => null);

    const game = {
      title: gameAssets?.title ?? installedGame.title,
      iconUrl: gameAssets?.iconUrl ?? null,
      libraryHeroImageUrl: gameAssets?.libraryHeroImageUrl ?? null,
      logoImageUrl: gameAssets?.logoImageUrl ?? null,
      objectId: installedGame.objectId,
      shop: "steam" as const,
      remoteId: null,
      isDeleted: false,
      playTimeInMilliseconds: 0,
      lastTimePlayed: null,
      addedToLibraryAt: new Date(),
      platform: null,
      launchThroughSteam: true,
    };

    await gamesSublevel.put(gameKey, game);
    await createGame(game).catch(() => {});

    AchievementWatcherManager.firstSyncWithRemoteIfNeeded(
      game.shop,
      game.objectId
    );

    importedGames.push({
      objectId: installedGame.objectId,
      title: game.title,
    });
  }

  await syncSteamPlaytimeForLibrary().catch((error) => {
    logger.error("[SteamLibrary] Failed to sync Steam playtime", error);
  });

  WindowManager.sendToAppWindows("on-library-batch-complete");

  const hasImportedGames = importedGames.length > 0;

  await LocalNotificationManager.createNotification(
    "STEAM_IMPORT_COMPLETE",
    t(
      hasImportedGames
        ? "steam_import_complete_title"
        : "steam_import_no_results_title",
      { ns: "notifications" }
    ),
    t(
      hasImportedGames
        ? "steam_import_complete_description"
        : "steam_import_no_results_description",
      { ns: "notifications", count: importedGames.length }
    ),
    { url: "/library" }
  ).catch(() => {});

  return { importedGames, totalInstalled: installedGames.length };
};

registerEvent("importSteamGames", importSteamGames);
