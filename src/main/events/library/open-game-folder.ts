import { gameRepository } from "@main/repository";
import path from "node:path";

import { shell } from "electron";
import { getDownloadsPath } from "../helpers/get-downloads-path";
import { registerEvent } from "../register-event";

const openGameFolder = async (
  _event: Electron.IpcMainInvokeEvent,
  gameId: number
): Promise<void | boolean> => {
  const game = await gameRepository.findOne({ where: { id: gameId } });

  if (!game) return true;

  let gamePath;

  if (game.executablePath) {
    gamePath = path.dirname(game.executablePath);
  } else {
    gamePath = game.folderName
      ? path.join(await getDownloadsPath(), game.folderName)
      : await getDownloadsPath();
  }

  shell.openPath(gamePath);
};

registerEvent(openGameFolder, {
  name: "openGameFolder",
});
