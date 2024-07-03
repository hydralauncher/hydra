import { IsNull, Not } from "typeorm";
import { gameRepository } from "@main/repository";
import { WindowManager } from "./window-manager";
import { createGame, updateGamePlaytime } from "./library-sync";
import { GameRunning } from "@types";
import { RPCManager } from "./download";

export const gamesPlaytime = new Map<
  number,
  { lastTick: number; firstTick: number }
>();

export const watchProcesses = async () => {
  const games = await gameRepository.find({
    where: {
      executablePath: Not(IsNull()),
      isDeleted: false,
    },
  });

  if (games.length === 0) return;

  const processes = (await RPCManager.getProccessList()) || [];

  for (const game of games) {
    const executablePath = game.executablePath!;

    const gameProcess = processes.find((runningProcess) => {
      return executablePath == runningProcess;
    });

    if (gameProcess) {
      if (gamesPlaytime.has(game.id)) {
        const gamePlaytime = gamesPlaytime.get(game.id)!;

        const zero = gamePlaytime.lastTick;
        const delta = performance.now() - zero;

        await gameRepository.update(game.id, {
          playTimeInMilliseconds: game.playTimeInMilliseconds + delta,
          lastTimePlayed: new Date(),
        });

        gamesPlaytime.set(game.id, {
          ...gamePlaytime,
          lastTick: performance.now(),
        });
      } else {
        if (game.remoteId) {
          updateGamePlaytime(game, 0, new Date());
        } else {
          createGame({ ...game, lastTimePlayed: new Date() }).then(
            (response) => {
              const { id: remoteId } = response.data;
              gameRepository.update({ objectID: game.objectID }, { remoteId });
            }
          );
        }

        gamesPlaytime.set(game.id, {
          lastTick: performance.now(),
          firstTick: performance.now(),
        });
      }
    } else if (gamesPlaytime.has(game.id)) {
      const gamePlaytime = gamesPlaytime.get(game.id)!;
      gamesPlaytime.delete(game.id);

      if (game.remoteId) {
        updateGamePlaytime(
          game,
          performance.now() - gamePlaytime.firstTick,
          game.lastTimePlayed!
        );
      } else {
        createGame(game).then((response) => {
          const { id: remoteId } = response.data;
          gameRepository.update({ objectID: game.objectID }, { remoteId });
        });
      }
    }
  }

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
