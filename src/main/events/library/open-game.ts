import { gameRepository } from "@main/repository";

import { registerEvent } from "../register-event";
import { shell } from "electron";

const openGame = async (
  _event: Electron.IpcMainInvokeEvent,
  gameId: number,
  executablePath: string
) => {
  await gameRepository.update({ id: gameId }, { executablePath });

  shell.openPath(executablePath);
};

registerEvent(openGame, {
  name: "openGame",
});
