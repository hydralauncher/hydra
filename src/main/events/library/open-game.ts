import { gameRepository } from "@main/repository";

import { shell } from "electron";
import { registerEvent } from "../register-event";

const openGame = async (
  _event: Electron.IpcMainInvokeEvent,
  gameId: number,
  executablePath: string
) => {
  await gameRepository.update(
    {
      id: gameId,
    },
    { executablePath }
  );

  shell.openPath(executablePath);
};

registerEvent("openGame", openGame);
