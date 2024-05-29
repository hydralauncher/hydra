import path from "node:path";

import { IsNull, Not } from "typeorm";
import { gameRepository } from "@main/repository";
import { getProcesses } from "@main/helpers";
import { WindowManager } from "./window-manager";

const gamesPlaytime = new Map<number, number>();

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
        const zero = gamesPlaytime.get(game.id) ?? 0;
        const delta = performance.now() - zero;

        if (WindowManager.mainWindow) {
          WindowManager.mainWindow.webContents.send("on-playtime", game.id);
        }

        await gameRepository.update(game.id, {
          playTimeInMilliseconds: game.playTimeInMilliseconds + delta,
          lastTimePlayed: new Date(),
        });
      }

      gamesPlaytime.set(game.id, performance.now());
    } else if (gamesPlaytime.has(game.id)) {
      gamesPlaytime.delete(game.id);

      if (WindowManager.mainWindow) {
        WindowManager.mainWindow.webContents.send("on-game-close", game.id);
      }
    }
  }
};
