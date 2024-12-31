import { gameRepository } from "@main/repository";

import { registerEvent } from "../register-event";
import { shell } from "electron";
import { spawn } from "child_process";
import { parseExecutablePath } from "../helpers/parse-executable-path";
import { parseLaunchOptions } from "../helpers/parse-launch-options";

const openGame = async (
  _event: Electron.IpcMainInvokeEvent,
  gameId: number,
  executablePath: string,
  launchOptions: string | null
) => {
  const parsedPath = parseExecutablePath(executablePath);
  const parsedParams = parseLaunchOptions(launchOptions);

  await gameRepository.update(
    { id: gameId },
    { executablePath: parsedPath, launchOptions }
  );

  if (
    process.platform === "linux" ||
    process.platform === "darwin" ||
    parsedParams.length === 0
  ) {
    shell.openPath(parsedPath);
    return;
  }

  spawn(parsedPath, parsedParams, { shell: false, detached: true });
};

registerEvent("openGame", openGame);
