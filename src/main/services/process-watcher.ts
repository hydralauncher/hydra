import path from "node:path";

import { IsNull, Not } from "typeorm";

import { gameRepository } from "@main/repository";
import { getProcesses } from "@main/helpers";
import { WindowManager } from "./window-manager";

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export const startProcessWatcher = async () => {
  const sleepTime = 100;
  const gamesPlaytime = new Map<number, number>();

  // eslint-disable-next-line no-constant-condition
  while (true) {
    const games = await gameRepository.find({
      where: {
        executablePath: Not(IsNull()),
      },
    });

    const processes = await getProcesses();

    for (const game of games) {
      const gameProcess = processes.find((runningProcess) => {
        const basename = path.win32.basename(game.executablePath);
        const basenameWithoutExtension = path.win32.basename(
          game.executablePath,
          path.extname(game.executablePath)
        );

        if (process.platform === "win32") {
          return runningProcess.name === basename;
        }

        return [basename, basenameWithoutExtension].includes(
          runningProcess.name
        );
      });

      if (gameProcess) {
        if (gamesPlaytime.has(game.id)) {
          const zero = gamesPlaytime.get(game.id);
          const delta = performance.now() - zero;

          if (WindowManager.mainWindow) {
            WindowManager.mainWindow.webContents.send("on-playtime", game.id);
          }

          await gameRepository.update(game.id, {
            playTimeInMilliseconds: game.playTimeInMilliseconds + delta,
          });

          gameRepository.update(game.id, {
            lastTimePlayed: new Date().toUTCString(),
          });

          gamesPlaytime.set(game.id, performance.now());
          await sleep(sleepTime);
          continue;
        }

        gamesPlaytime.set(game.id, performance.now());

        await sleep(sleepTime);
        continue;
      }

      if (gamesPlaytime.has(game.id)) {
        gamesPlaytime.delete(game.id);
        if (WindowManager.mainWindow) {
          WindowManager.mainWindow.webContents.send("on-game-close", game.id);
        }
      }

      await sleep(sleepTime);
    }
  }
};
