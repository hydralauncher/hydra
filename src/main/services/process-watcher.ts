import { gameRepository } from "@main/repository";
import { WindowManager } from "./window-manager";
import { createGame, updateGamePlaytime } from "./library-sync";
import type { GameRunning } from "@types";
import { PythonInstance } from "./download";
import { Game } from "@main/entity";
import axios from "axios";

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

    const executable = executablePath.slice(
      executablePath.lastIndexOf(process.platform === "win32" ? "\\" : "/") + 1
    );

    const gameProcess = processMap.get(executable)?.has(executablePath);

    if (gameProcess) {
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
