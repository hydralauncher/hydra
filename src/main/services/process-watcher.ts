import { gameRepository } from "@main/repository";
import { WindowManager } from "./window-manager";
import { createGame, updateGamePlaytime } from "./library-sync";
import type { GameRunning } from "@types";
import { PythonRPC } from "./python-rpc";
import { Game } from "@main/entity";
import axios from "axios";
import { exec } from "child_process";
import { ProcessPayload } from "./download/types";

const commands = {
  findWineDir: `lsof -c wine 2>/dev/null | grep '/drive_c/windows$' | head -n 1 | awk '{for(i=9;i<=NF;i++) printf "%s ", $i; print ""}'`,
  findWineExecutables: `lsof -c wine 2>/dev/null | grep '\\.exe$' | awk '{for(i=9;i<=NF;i++) printf "%s ", $i; print ""}'`,
};

export const gamesPlaytime = new Map<
  number,
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

const TICKS_TO_UPDATE_API = 120;
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
      pathSet.forEach((path) => {
        if (path.toLowerCase().endsWith(executable.name)) {
          gameRepository.update(
            { objectID: gameId, shop: "steam" },
            { executablePath: path }
          );

          if (isLinuxPlatform) {
            exec(commands.findWineDir, (err, out) => {
              if (err) return;

              gameRepository.update(
                { objectID: gameId, shop: "steam" },
                {
                  winePrefixPath: out.trim().replace("/drive_c/windows", ""),
                }
              );
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
  const games = await gameRepository.find({
    where: {
      isDeleted: false,
    },
  });

  if (!games.length) return;

  const processMap = await getSystemProcessMap();

  for (const game of games) {
    const executablePath = game.executablePath;
    if (!executablePath) {
      if (gameExecutables[game.objectID]) {
        findGamePathByProcess(processMap, game.objectID);
      }
      continue;
    }

    const executable = executablePath
      .slice(executablePath.lastIndexOf(isWindowsPlatform ? "\\" : "/") + 1)
      .toLowerCase();

    const hasProcess = processMap.get(executable)?.has(executablePath);

    if (hasProcess) {
      if (gamesPlaytime.has(game.id)) {
        onTickGame(game);
      } else {
        onOpenGame(game);
      }
    } else if (gamesPlaytime.has(game.id)) {
      onCloseGame(game);
    }
  }

  currentTick++;

  if (WindowManager.mainWindow) {
    const gamesRunning = Array.from(gamesPlaytime.entries()).map((entry) => {
      return {
        id: entry[0],
        sessionDurationInMillis: performance.now() - entry[1].firstTick,
      };
    });

    WindowManager.mainWindow.webContents.send(
      "on-games-running",
      gamesRunning as Pick<GameRunning, "id" | "sessionDurationInMillis">[]
    );
  }
};

function onOpenGame(game: Game) {
  const now = performance.now();

  gamesPlaytime.set(game.id, {
    lastTick: now,
    firstTick: now,
    lastSyncTick: now,
  });

  if (game.remoteId) {
    updateGamePlaytime(game, 0, new Date()).catch(() => {});
  } else {
    createGame({ ...game, lastTimePlayed: new Date() }).catch(() => {});
  }
}

function onTickGame(game: Game) {
  const now = performance.now();
  const gamePlaytime = gamesPlaytime.get(game.id)!;

  const delta = now - gamePlaytime.lastTick;

  gameRepository.update(game.id, {
    playTimeInMilliseconds: game.playTimeInMilliseconds + delta,
    lastTimePlayed: new Date(),
  });

  gamesPlaytime.set(game.id, {
    ...gamePlaytime,
    lastTick: now,
  });

  if (currentTick % TICKS_TO_UPDATE_API === 0) {
    const gamePromise = game.remoteId
      ? updateGamePlaytime(
          game,
          now - gamePlaytime.lastSyncTick,
          game.lastTimePlayed!
        )
      : createGame(game);

    gamePromise
      .then(() => {
        gamesPlaytime.set(game.id, {
          ...gamePlaytime,
          lastSyncTick: now,
        });
      })
      .catch(() => {});
  }
}

const onCloseGame = (game: Game) => {
  const gamePlaytime = gamesPlaytime.get(game.id)!;
  gamesPlaytime.delete(game.id);

  if (game.remoteId) {
    updateGamePlaytime(
      game,
      performance.now() - gamePlaytime.lastSyncTick,
      game.lastTimePlayed!
    ).catch(() => {});
  } else {
    createGame(game).catch(() => {});
  }
};
