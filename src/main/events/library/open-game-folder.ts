import { gameRepository } from "@main/repository";
import path from "node:path";

import { shell } from "electron";
import { getDownloadsPath } from "../helpers/get-downloads-path";
import { registerEvent } from "../register-event";

const openGameFolder = async (
  _event: Electron.IpcMainInvokeEvent,
  gameId: number
) => {
  const game = await gameRepository.findOne({ where: { id: gameId } });

  if (!game) return true;

  let gamePath = game.executablePath ?? (await getDownloadsPath());
  gamePath = path.dirname(gamePath);

  const fullPath = path.join(gamePath, game.folderName);

  // if (!fs.existsSync(fullPath)) {
  //   await gameRepository.delete({ id: gameId });
  //   return true;
  // }

  shell.openPath(fullPath);
};

registerEvent(openGameFolder, {
  name: "openGameFolder",
});
