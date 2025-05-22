import { WindowManager } from "./window-manager";
import { createGame, updateGamePlaytime } from "./library-sync";
import type { Game, GameRunning } from "@types";
import { PythonRPC } from "./python-rpc";
import axios from "axios";
import { exec } from "child_process";
import { ProcessPayload } from "./download/types";
import { gamesSublevel, levelKeys } from "@main/level";
import { CloudSync } from "./cloud-sync";

const commands = {
  findWineDir: `lsof -c wine 2>/dev/null | grep '/drive_c/windows$' | head -n 1 | awk '{for(i=9;i<=NF;i++) printf "%s ", $i; print ""}'`,
  findWineExecutables: `lsof -c wine 2>/dev/null | grep '\\.exe$' | awk '{for(i=9;i<=NF;i++) printf "%s ", $i; print ""}'`,
};

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

const isWindowsPlatform = process.platform === "win32";
const isLinuxPlatform = process.platform === "linux";

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
        if (isWindowsPlatform) {
          return executable.os === "win32";
        } else if (isLinuxPlatform) {
          return executable.os === "linux" || executable.os === "win32";
        }
        return false;
      })
      .map((executable) => {
        return {
          name: isWindowsPlatform
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

const findGamePathByProcess = (
  processMap: Map<string, Set<string>>,
  gameId: string
) => {
  const executables = gameExecutables[gameId];

  for (const executable of executables) {
    const pathSet = processMap.get(executable.exe);

    if (pathSet) {
      pathSet.forEach(async (path) => {
        if (path.toLowerCase().endsWith(executable.name)) {
          const gameKey = levelKeys.game("steam", gameId);
          const game = await gamesSublevel.get(gameKey);

          if (game) {
            gamesSublevel.put(gameKey, {
              ...game,
              executablePath: path,
            });
          }

          if (isLinuxPlatform) {
            exec(commands.findWineDir, (err, out) => {
              if (err) return;

              if (game) {
                gamesSublevel.put(gameKey, {
                  ...game,
                  winePrefixPath: out.trim().replace("/drive_c/windows", ""),
                });
              }
            });
          }
        }
      });
    }
  }
};

const getSystemProcessMap = async () => {
  const processes =
    (await PythonRPC.rpc.get<ProcessPayload[] | null>("/process-list")).data ||
    [];

  const map = new Map<string, Set<string>>();

  processes.forEach((process) => {
    const key = process.name?.toLowerCase();
    const value = process.exe;

    if (!key || !value) return;

    const currentSet = map.get(key) ?? new Set();
    map.set(key, currentSet.add(value));
  });

  if (isLinuxPlatform) {
    await new Promise((res) => {
      exec(commands.findWineExecutables, (err, out) => {
        if (err) {
          res(null);
          return;
        }

        const pathSet = new Set(
          out
            .trim()
            .split("\n")
            .map((path) => path.trim())
        );

        pathSet.forEach((path) => {
          if (path.startsWith("/usr")) return;

          const key = path.slice(path.lastIndexOf("/") + 1).toLowerCase();

          if (!key || !path) return;

          const currentSet = map.get(key) ?? new Set();
          map.set(key, currentSet.add(path));
        });

        res(null);
      });
    });
  }

  return map;
};

export const watchProcesses = async () => {
  const games = await gamesSublevel
    .values()
    .all()
    .then((results) => {
      return results.filter((game) => game.isDeleted === false);
    });

  if (!games.length) return;

  const processMap = await getSystemProcessMap();

  for (const game of games) {
    const executablePath = game.executablePath;
    if (!executablePath) {
      if (gameExecutables[game.objectId]) {
        findGamePathByProcess(processMap, game.objectId);
      }
      continue;
    }

    const executable = executablePath
      .slice(executablePath.lastIndexOf(isWindowsPlatform ? "\\" : "/") + 1)
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
