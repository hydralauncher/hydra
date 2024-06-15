import path from "node:path";

import { IsNull, Not } from "typeorm";
import { gameRepository } from "@main/repository";
import { getProcesses } from "@main/helpers";
import { WindowManager } from "./window-manager";
import { HydraApi } from "./hydra-api";

const gamesPlaytime = new Map<
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

  const processes = await getProcesses();

  for (const game of games) {
    const executablePath = game.executablePath!;
    const basename = path.win32.basename(executablePath);
    const basenameWithoutExtension = path.win32.basename(
      executablePath,
      path.extname(executablePath)
    );

    const gameProcess = processes.find((runningProcess) => {
      if (process.platform === "win32") {
        return runningProcess.name === basename;
      }

      return [basename, basenameWithoutExtension].includes(runningProcess.name);
    });

    if (gameProcess) {
      if (gamesPlaytime.has(game.id)) {
        const gamePlaytime = gamesPlaytime.get(game.id)!;

        const zero = gamePlaytime.lastTick;
        const delta = performance.now() - zero;

        if (WindowManager.mainWindow) {
          WindowManager.mainWindow.webContents.send("on-playtime", game.id);
        }

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
          HydraApi.put(`/games/${game.remoteId}`, {
            playTimeDeltaInMilliseconds: 0,
            lastTimePlayed: new Date(),
          });
        } else {
          HydraApi.post("/games", {
            objectId: game.objectID,
            playTimeInMilliseconds: Math.round(game.playTimeInMilliseconds),
            shop: game.shop,
            lastTimePlayed: new Date(),
          }).then((response) => {
            const { id: remoteId } = response.data;
            gameRepository.update({ objectID: game.objectID }, { remoteId });
          });
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
        HydraApi.put(`/games/${game.remoteId}`, {
          playTimeInMilliseconds: Math.round(
            performance.now() - gamePlaytime.firstTick
          ),
          lastTimePlayed: game.lastTimePlayed,
        });
      } else {
        HydraApi.post("/games", {
          objectId: game.objectID,
          playTimeInMilliseconds: Math.round(game.playTimeInMilliseconds),
          shop: game.shop,
          lastTimePlayed: game.lastTimePlayed,
        }).then((response) => {
          const { id: remoteId } = response.data;
          gameRepository.update({ objectID: game.objectID }, { remoteId });
        });
      }

      if (WindowManager.mainWindow) {
        WindowManager.mainWindow.webContents.send("on-game-close", game.id);
      }
    }
  }
};
