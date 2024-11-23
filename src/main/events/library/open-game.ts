import { gameRepository } from "@main/repository";

import { registerEvent } from "../register-event";
import { shell } from "electron";
import { parseExecutablePath } from "../helpers/parse-executable-path";

const openGame = async (
  _event: Electron.IpcMainInvokeEvent,
  gameId: number,
  executablePath: string
) => {
  const parsedPath = parseExecutablePath(executablePath);

  await gameRepository.update({ id: gameId }, { executablePath: parsedPath });

  shell.openPath(parsedPath);
};

registerEvent("openGame", openGame);
