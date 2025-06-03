import { WindowManager } from "./window-manager";
import { createGame, updateGamePlaytime } from "./library-sync";
import type { Game, GameRunning } from "@types";
import { PythonRPC } from "./python-rpc";
import axios from "axios";
import { ProcessPayload } from "./download/types";
import { gamesSublevel, levelKeys } from "@main/level";
import { CloudSync } from "./cloud-sync";
import { logger } from "./logger";
import path from "path";
import { AchievementWatcherManager } from "./achievements/achievement-watcher-manager";

export const gamesPlaytime = new Map<
  string,
  { lastTick: number; firstTick: number; lastSyncTick: number }
>();

interface ExecutableInfo {
  name: string;
  os: string;
  exe: string;
}

interface GameExecutables {
  [key: string]: ExecutableInfo[];
}

const TICKS_TO_UPDATE_API = 80;
let currentTick = 1;

const platform = process.platform;

const getGameExecutables = async () => {
  const gameExecutables = (
    await axios
      .get(
        import.meta.env.MAIN_VITE_EXTERNAL_RESOURCES_URL +
          "/game-executables.json"
      )
      .catch(() => {
        return { data: {} };
      })
  ).data as GameExecutables;

  Object.keys(gameExecutables).forEach((key) => {
    gameExecutables[key] = gameExecutables[key]
      .filter((executable) => {
        if (platform === "win32") {
          return executable.os === "win32";
        } else if (platform === "linux") {
          return executable.os === "linux" || executable.os === "win32";
        }

        return false;
      })
      .map((executable) => {
        return {
          name:
            platform === "win32"
              ? executable.name.replace(/\//g, "\\")
              : executable.name,
          os: executable.os,
          exe: executable.name.slice(executable.name.lastIndexOf("/") + 1),
        };
      });
  });

  return gameExecutables;
};

const gameExecutables = await getGameExecutables();

const findGamePathByProcess = async (
  processMap: Map<string, Set<string>>,
  winePrefixMap: Map<string, string>,
  gameId: string
) => {
  const executables = gameExecutables[gameId];

  for (const executable of executables) {
    const pathSet = processMap.get(executable.exe);

    if (pathSet) {
      for (const path of pathSet) {
        if (path.toLowerCase().endsWith(executable.name)) {
          const gameKey = levelKeys.game("steam", gameId);
          const game = await gamesSublevel.get(gameKey);

          if (game) {
            const updatedGame: Game = {
              ...game,
              executablePath: path,
            };

            if (process.platform === "linux" && winePrefixMap.has(path)) {
              updatedGame.winePrefixPath = winePrefixMap.get(path)!;
            }

            await gamesSublevel.put(gameKey, updatedGame);
            logger.info("Set game path", gameKey, path);
          }
        }
      }
    }
  }
};

const getSystemProcessMap = async () => {
  const processes =
    (await PythonRPC.rpc.get<ProcessPayload[] | null>("/process-list")).data ||
    [];

  const processMap = new Map<string, Set<string>>();
  const winePrefixMap = new Map<string, string>();

  processes.forEach((process) => {
    const key = process.name?.toLowerCase();
    const value =
      platform === "win32"
        ? process.exe
        : path.join(process.cwd ?? "", process.name ?? "");

    if (!key || !value) return;

    const STEAM_COMPAT_DATA_PATH = process.environ?.STEAM_COMPAT_DATA_PATH;

    if (STEAM_COMPAT_DATA_PATH) {
      winePrefixMap.set(value, STEAM_COMPAT_DATA_PATH);
    }

    const currentSet = processMap.get(key) ?? new Set();
    processMap.set(key, currentSet.add(value));
  });

  return { processMap, winePrefixMap };
};

export const watchProcesses = async () => {
  const games = await gamesSublevel
    .values()
    .all()
    .then((results) => {
      return results.filter((game) => game.isDeleted === false);
    });

  if (!games.length) return;

  const { processMap, winePrefixMap } = await getSystemProcessMap();

  for (const game of games) {
    const executablePath = game.executablePath;
    if (!executablePath) {
      if (gameExecutables[game.objectId]) {
        await findGamePathByProcess(processMap, winePrefixMap, game.objectId);
      }

      continue;
    }

    const executable = executablePath
      .slice(executablePath.lastIndexOf(platform === "win32" ? "\\" : "/") + 1)
      .toLowerCase();

    const hasProcess = processMap.get(executable)?.has(executablePath);

    if (hasProcess) {
      if (gamesPlaytime.has(levelKeys.game(game.shop, game.objectId))) {
        onTickGame(game);
      } else {
        onOpenGame(game);
      }
    } else if (gamesPlaytime.has(levelKeys.game(game.shop, game.objectId))) {
      onCloseGame(game);
    }
  }

  currentTick++;

  if (WindowManager.mainWindow) {
    const gamesRunning = Array.from(gamesPlaytime.entries()).map((entry) => {
      return {
        id: entry[0],
        sessionDurationInMillis: performance.now() - entry[1].firstTick,
      } as Pick<GameRunning, "id" | "sessionDurationInMillis">;
    });

    WindowManager.mainWindow.webContents.send("on-games-running", gamesRunning);
  }
};

function onOpenGame(game: Game) {
  const now = performance.now();

  AchievementWatcherManager.firstSyncWithRemoteIfNeeded(
    game.shop,
    game.objectId
  );

  gamesPlaytime.set(levelKeys.game(game.shop, game.objectId), {
    lastTick: now,
    firstTick: now,
    lastSyncTick: now,
  });

  if (game.remoteId) {
    updateGamePlaytime(
      game,
      game.unsyncedDeltaPlayTimeInMilliseconds ?? 0,
      new Date()
    )
      .then(() => {
        gamesSublevel.put(levelKeys.game(game.shop, game.objectId), {
          ...game,
          unsyncedDeltaPlayTimeInMilliseconds: 0,
        });
      })
      .catch(() => {});

    if (game.automaticCloudSync) {
      CloudSync.uploadSaveGame(
        game.objectId,
        game.shop,
        null,
        CloudSync.getBackupLabel(true)
      );
    }
  } else {
    createGame({ ...game, lastTimePlayed: new Date() }).catch(() => {});
  }
}

function onTickGame(game: Game) {
  const now = performance.now();
  const gamePlaytime = gamesPlaytime.get(
    levelKeys.game(game.shop, game.objectId)
  )!;

  const delta = now - gamePlaytime.lastTick;

  gamesSublevel.put(levelKeys.game(game.shop, game.objectId), {
    ...game,
    playTimeInMilliseconds: (game.playTimeInMilliseconds ?? 0) + delta,
    lastTimePlayed: new Date(),
  });

  gamesPlaytime.set(levelKeys.game(game.shop, game.objectId), {
    ...gamePlaytime,
    lastTick: now,
  });

  if (currentTick % TICKS_TO_UPDATE_API === 0) {
    const deltaToSync =
      now -
      gamePlaytime.lastSyncTick +
      (game.unsyncedDeltaPlayTimeInMilliseconds ?? 0);

    const gamePromise = game.remoteId
      ? updateGamePlaytime(game, deltaToSync, game.lastTimePlayed!)
      : createGame(game);

    gamePromise
      .then(() => {
        gamesSublevel.put(levelKeys.game(game.shop, game.objectId), {
          ...game,
          unsyncedDeltaPlayTimeInMilliseconds: 0,
        });
      })
      .catch(() => {
        gamesSublevel.put(levelKeys.game(game.shop, game.objectId), {
          ...game,
          unsyncedDeltaPlayTimeInMilliseconds: deltaToSync,
        });
      })
      .finally(() => {
        gamesPlaytime.set(levelKeys.game(game.shop, game.objectId), {
          ...gamePlaytime,
          lastSyncTick: now,
        });
      });
  }
}

const onCloseGame = (game: Game) => {
  const gamePlaytime = gamesPlaytime.get(
    levelKeys.game(game.shop, game.objectId)
  )!;
  gamesPlaytime.delete(levelKeys.game(game.shop, game.objectId));

  if (game.remoteId) {
    if (game.automaticCloudSync) {
      CloudSync.uploadSaveGame(
        game.objectId,
        game.shop,
        null,
        CloudSync.getBackupLabel(true)
      );
    }

    const deltaToSync =
      performance.now() -
      gamePlaytime.lastSyncTick +
      (game.unsyncedDeltaPlayTimeInMilliseconds ?? 0);

    return updateGamePlaytime(game, deltaToSync, game.lastTimePlayed!)
      .then(() => {
        return gamesSublevel.put(levelKeys.game(game.shop, game.objectId), {
          ...game,
          unsyncedDeltaPlayTimeInMilliseconds: 0,
        });
      })
      .catch(() => {
        return gamesSublevel.put(levelKeys.game(game.shop, game.objectId), {
          ...game,
          unsyncedDeltaPlayTimeInMilliseconds: deltaToSync,
        });
      });
  } else {
    return createGame(game).catch(() => {});
  }
};

export const clearGamesPlaytime = async () => {
  for (const game of gamesPlaytime.keys()) {
    const gameData = await gamesSublevel.get(game);

    if (gameData) {
      await onCloseGame(gameData);
    }
  }

  gamesPlaytime.clear();
};
