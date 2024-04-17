import path from "node:path";

import { IsNull, Not } from "typeorm";
import psList from "ps-list";

import { gameRepository } from "@main/repository";
import { GameStatus } from "@main/constants";

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export const startProcessWatcher = async () => {
  const gamesRunning = new Set<number>();
  let zero = performance.now();

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
      const gameProcess = processes.find((process) =>
        process.cmd.includes(path.dirname(game.executablePath))
      );

      if (gameProcess) {
        if (gamesRunning.has(game.id)) {
          const delta = performance.now() - zero;

          await gameRepository.update(game.id, {
            playTimeInMilliseconds: game.playTimeInMilliseconds + delta,
          });

          zero = performance.now();
          await sleep(1);
          continue;
        }

        gamesRunning.add(game.id);
        gameRepository.update(game.id, {
          lastTimePlayed: new Date(),
        });

        zero = performance.now();
        await sleep(1);
        continue;
      }

      if (gamesRunning.has(game.id)) gamesRunning.delete(game.id);
      zero = performance.now();
      await sleep(1);
    }
  }
};
