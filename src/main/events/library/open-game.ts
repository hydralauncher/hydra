import { gameRepository } from "@main/repository";

import { registerEvent } from "../register-event";
import { shell } from "electron";
import { exec } from "child_process";
import { parseExecutablePath } from "../helpers/parse-executable-path";
import { parseLaunchOptions } from "../helpers/parse-launch-options";
import { logger } from "@main/services";

const openGame = async (
  _event: Electron.IpcMainInvokeEvent,
  gameId: number,
  executablePath: string,
  launchOptions: string | null
) => {
  const parsedPath = parseExecutablePath(executablePath);
  const parsedParams = parseLaunchOptions(launchOptions);
  const executeCommand = `"${parsedPath}" ${parsedParams}`;

  await gameRepository.update({ id: gameId }, { executablePath: parsedPath });

  if (process.platform === "linux" || process.platform === "darwin") {
    shell.openPath(parsedPath);
  }

  if (process.platform === "win32") {
    exec(executeCommand.trim(), (err) => {
      if (err) {
        logger.error(
          `Error opening game #${gameId} with command ${executeCommand}`,
          err
        );
      }
    });
  }
};

registerEvent("openGame", openGame);
