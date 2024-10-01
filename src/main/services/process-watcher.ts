import { IsNull, Not } from "typeorm";
import { gameRepository } from "@main/repository";
import { WindowManager } from "./window-manager";
import { createGame, updateGamePlaytime } from "./library-sync";
import { GameRunning } from "@types";
import { PythonInstance } from "./download";
import { Game } from "@main/entity";
import {
  startGameAchievementObserver,
  stopGameAchievementObserver,
} from "@main/services/achievements/game-achievements-observer";

export const gamesPlaytime = new Map<
  number,
  { lastTick: number; firstTick: number; lastSyncTick: number }
>();

const TICKS_TO_UPDATE_API = 120;
let currentTick = 1;

export const watchProcesses = async () => {
  const games = await gameRepository.find({
    where: {
      executablePath: Not(IsNull()),
      isDeleted: false,
    },
  });

  if (games.length === 0) return;
  const processes = await PythonInstance.getProcessList();

  const processSet = new Set(processes.map((process) => process.exe));

  for (const game of games) {
    const executablePath = game.executablePath!;

    const gameProcess = processSet.has(executablePath);

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

  startGameAchievementObserver(game);
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

  startGameAchievementObserver(game);
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

  stopGameAchievementObserver(game.id);
};
