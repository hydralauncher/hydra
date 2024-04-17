import path from "node:path";

import { IsNull, Not } from "typeorm";
import psList from "ps-list";

import { gameRepository } from "@main/repository";
import { GameStatus } from "@main/constants";
import { WindowManager } from "./window-manager";

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export const startProcessWatcher = async () => {
  const sleepTime = 1000;
  const gamesPlaytime = new Map<number, number>();

  // eslint-disable-next-line no-constant-condition
  while (true) {
    const games = await gameRepository.find({
      where: {
        executablePath: Not(IsNull()),
        status: GameStatus.Seeding,
      },
    });

    const processes = await psList();

    for (const game of games) {
      const gameProcess = processes.find((runningProcess) => {
        if (process.platform === "win32") {
          return (
            runningProcess.name === path.win32.basename(game.executablePath)
          );
        }

        /* TODO: This has to be tested on Linux */
        return runningProcess.cmd === path.win32.basename(game.executablePath);
      });

      if (gameProcess) {
        if (gamesPlaytime.has(game.id)) {
          const zero = gamesPlaytime.get(game.id);
          const delta = performance.now() - zero;

          WindowManager.mainWindow.webContents.send("on-playtime", game.id);

          await gameRepository.update(game.id, {
            playTimeInMilliseconds: game.playTimeInMilliseconds + delta,
          });

          gamesPlaytime.set(game.id, performance.now());
          await sleep(sleepTime);
          continue;
        }

        gamesPlaytime.set(game.id, performance.now());
        gameRepository.update(game.id, {
          lastTimePlayed: new Date().toUTCString(),
        });

        await sleep(sleepTime);
        continue;
      }

      if (gamesPlaytime.has(game.id)) gamesPlaytime.delete(game.id);
      await sleep(sleepTime);
    }
  }
};
