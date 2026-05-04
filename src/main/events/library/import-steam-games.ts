import { registerEvent } from "../register-event";
import {
  getInstalledSteamGames,
  findSteamGameExecutable,
} from "@main/services/steam";
import { createGame } from "@main/services/library-sync";
import { gamesShopAssetsSublevel, gamesSublevel, levelKeys } from "@main/level";
import { AchievementWatcherManager } from "@main/services/achievements/achievement-watcher-manager";
import { GameExecutables, logger, WindowManager } from "@main/services";
import fs from "node:fs";
import path from "node:path";

const sendProgress = (payload: {
  totalGames: number;
  currentIndex: number;
  currentGame: string;
  importedCount: number;
  done: boolean;
}) => {
  const mainWindow = WindowManager.mainWindow;
  if (mainWindow) {
    mainWindow.webContents.send("on-steam-import-progress", payload);
  }
};

const resolveExecutablePath = async (
  appId: string,
  installPath: string
): Promise<string | null> => {
  const knownExecutables = GameExecutables.getExecutablesForGame(appId);

  if (knownExecutables && knownExecutables.length > 0) {
    const normalizedNames = new Set(
      knownExecutables.map((name) => name.toLowerCase())
    );

    try {
      const entries = await fs.promises.readdir(installPath, {
        withFileTypes: true,
        recursive: true,
      });

      for (const entry of entries) {
        if (entry.isFile() && normalizedNames.has(entry.name.toLowerCase())) {
          const parentPath =
            "parentPath" in entry ? (entry.parentPath as string) : installPath;
          return path.join(parentPath, entry.name);
        }
      }
    } catch {
      // Directory may not exist
    }
  }

  return findSteamGameExecutable(installPath);
};

const importSteamGames = async (_event: Electron.IpcMainInvokeEvent) => {
  const installedGames = await getInstalledSteamGames();

  sendProgress({
    totalGames: installedGames.length,
    currentIndex: 0,
    currentGame: "",
    importedCount: 0,
    done: false,
  });

  let importedCount = 0;
  const alreadyInLibrary: string[] = [];

  for (let i = 0; i < installedGames.length; i++) {
    const steamGame = installedGames[i];
    const gameKey = levelKeys.game("steam", steamGame.appId);

    sendProgress({
      totalGames: installedGames.length,
      currentIndex: i + 1,
      currentGame: steamGame.name,
      importedCount,
      done: false,
    });

    const existingGame = await gamesSublevel.get(gameKey).catch(() => null);

    const installPath = path.join(
      steamGame.libraryPath,
      "steamapps",
      "common",
      steamGame.installDir
    );

    const executablePath = await resolveExecutablePath(
      steamGame.appId,
      installPath
    );

    if (existingGame && !existingGame.isDeleted) {
      if (executablePath && existingGame.executablePath !== executablePath) {
        await gamesSublevel.put(gameKey, {
          ...existingGame,
          executablePath,
        });
      }
      alreadyInLibrary.push(steamGame.appId);
      continue;
    }

    const gameAssets = await gamesShopAssetsSublevel
      .get(gameKey)
      .catch(() => null);

    const game = existingGame
      ? {
          ...existingGame,
          isDeleted: false,
          executablePath: executablePath ?? existingGame.executablePath,
        }
      : {
          title: steamGame.name,
          iconUrl: gameAssets?.iconUrl ?? null,
          libraryHeroImageUrl: gameAssets?.libraryHeroImageUrl ?? null,
          logoImageUrl: gameAssets?.logoImageUrl ?? null,
          objectId: steamGame.appId,
          shop: "steam" as const,
          remoteId: null,
          isDeleted: false,
          playTimeInMilliseconds: 0,
          lastTimePlayed: null,
          executablePath,
        };

    await gamesSublevel.put(gameKey, game);
    await createGame(game).catch(() => {});
    AchievementWatcherManager.firstSyncWithRemoteIfNeeded(
      "steam",
      steamGame.appId
    );

    importedCount++;
  }

  if (importedCount > 0) {
    const mainWindow = WindowManager.mainWindow;
    if (mainWindow) {
      mainWindow.webContents.send("on-library-batch-complete");
    }
  }

  sendProgress({
    totalGames: installedGames.length,
    currentIndex: installedGames.length,
    currentGame: "",
    importedCount,
    done: true,
  });

  logger.info("Steam games import completed", {
    totalFound: installedGames.length,
    importedCount,
    alreadyInLibrary: alreadyInLibrary.length,
  });

  return {
    importedCount,
    totalFound: installedGames.length,
    alreadyInLibrary: alreadyInLibrary.length,
  };
};

registerEvent("importSteamGames", importSteamGames);
