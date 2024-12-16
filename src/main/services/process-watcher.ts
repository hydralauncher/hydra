import { gameRepository } from "@main/repository";
import { WindowManager } from "./window-manager";
import { createGame, updateGamePlaytime } from "./library-sync";
import type { GameRunning } from "@types";
import { PythonInstance } from "./download";
import { Game } from "@main/entity";
import axios from "axios";
import { exec } from "child_process";

const commands = {
  findGameExecutableWithWineProcess: (executable: string) =>
    `lsof -c wine 2>/dev/null | grep -i ${executable} | awk \'{for(i=9;i<=NF;i++) printf "%s ", $i; print ""}\'`,
  findWineDir: () =>
    `lsof -c wine 2>/dev/null | grep -i drive_c/windows | head -n 1 | awk \'{for(i=9;i<=NF;i++) printf "%s ", $i; print ""}\'`,
};

export const gamesPlaytime = new Map<
  number,
  { lastTick: number; firstTick: number; lastSyncTick: number }
>();

interface ExecutableInfo {
  name: string;
  os: string;
}

interface GameExecutables {
  [key: string]: ExecutableInfo[];
}

const TICKS_TO_UPDATE_API = 120;
let currentTick = 1;

const gameExecutables = (
  await axios
    .get("https://assets.hydralauncher.gg/game-executables.json")
    .catch(() => {
      return { data: {} };
    })
).data as GameExecutables;

const findGamePathByProcess = (
  processMap: Map<string, Set<string>>,
  gameId: string
) => {
  if (process.platform === "win32") {
    const executables = gameExecutables[gameId].filter(
      (info) => info.os === "win32"
    );

    for (const executable of executables) {
      const exe = executable.name.slice(executable.name.lastIndexOf("/") + 1);

      if (!exe) continue;

      const pathSet = processMap.get(exe);

      if (pathSet) {
        const executableName = executable.name.replace(/\//g, "\\");

        pathSet.forEach((path) => {
          if (path.toLowerCase().endsWith(executableName)) {
            gameRepository.update(
              { objectID: gameId, shop: "steam" },
              { executablePath: path }
            );
          }
        });
      }
    }
  }

  if (process.platform === "linux") {
    const executables = gameExecutables[gameId].filter((info) => {
      if (info.os === "win32") return true;
      if (info.os === "linux") return true;
      return false;
    });

    for (const executable of executables) {
      if (executable.os === "win32") {
        const exe = executable.name.slice(executable.name.lastIndexOf("/") + 1);

        if (!exe) return;

        const hasProcess = processMap.get(exe);

        if (hasProcess) {
          new Promise((res) => {
            exec(
              commands.findGameExecutableWithWineProcess(exe),
              (err, out) => {
                if (err) {
                  res(false);
                  return;
                }

                const paths = [
                  ...new Set(
                    out
                      .trim()
                      .split("\n")
                      .map((path) => path.trim())
                  ),
                ];

                for (const path of paths) {
                  if (path.toLocaleLowerCase().endsWith(executable.name)) {
                    gameRepository.update(
                      { objectID: gameId, shop: "steam" },
                      { executablePath: path }
                    );

                    res(true);
                    return;
                  }
                }
                res(false);
              }
            );
          }).then((res) => {
            if (res) {
              exec(commands.findWineDir(), (err, out) => {
                if (err) return;

                gameRepository.update(
                  { objectID: gameId, shop: "steam" },
                  {
                    winePrefixPath: out.trim().replace("/drive_c/windows", ""),
                  }
                );
              });
            }
          });
        }
      } else {
        //TODO: linux case
      }
    }
  }
};

const getSystemProcessMap = async () => {
  const processes = await PythonInstance.getProcessList();

  const map = new Map<string, Set<string>>();

  processes.forEach((process) => {
    const key = process.name.toLowerCase();
    const value = process.exe;

    if (!key || !value) return;

    const currentSet = map.get(key) ?? new Set();
    map.set(key, currentSet.add(value));
  });

  return map;
};

const observeGameProcess = (hasProcess: boolean, game: Game) => {
  if (hasProcess) {
    if (gamesPlaytime.has(game.id)) {
      onTickGame(game);
    } else {
      onOpenGame(game);
    }
  } else if (gamesPlaytime.has(game.id)) {
    onCloseGame(game);
  }
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
      .slice(
        executablePath.lastIndexOf(process.platform === "win32" ? "\\" : "/") +
          1
      )
      .toLowerCase();

    const processSet = processMap.get(executable);

    if (!processSet) continue;

    if (process.platform === "win32") {
      const hasProcess = processSet.has(executablePath);

      observeGameProcess(hasProcess, game);
    }

    if (process.platform === "linux") {
      if (executable.endsWith(".exe")) {
        exec(
          commands.findGameExecutableWithWineProcess(executable),
          (err, out) => {
            if (err) return;

            const pathSet = new Set(
              out
                .trim()
                .split("\n")
                .map((path) => path.trim())
            );

            const hasProcess = pathSet.has(executablePath!);

            observeGameProcess(hasProcess, game);
          }
        );
      } else {
        //TODO: linux case
      }
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
