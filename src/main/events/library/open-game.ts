import { gameRepository } from "@main/repository";

import { registerEvent } from "../register-event";
import { shell } from "electron";
import { parseExecutablePath } from "../helpers/parse-executable-path";

const openGame = async (
  _event: Electron.IpcMainInvokeEvent,
  gameId: number,
  executablePath: string,
  launchOptions: string | null
) => {
  // TODO: revisit this for launchOptions
  const parsedPath = parseExecutablePath(executablePath);

  await gameRepository.update(
    { id: gameId },
    { executablePath: parsedPath, launchOptions }
  );

  shell.openPath(parsedPath);
};

registerEvent("openGame", openGame);
