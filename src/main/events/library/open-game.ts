import { gameRepository } from "@main/repository";
import path from "node:path";
import fs from "node:fs";

import { registerEvent } from "../register-event";
import { shell } from "electron";
import { getDownloadsPath } from "../helpers/get-downloads-path";

const openGame = async (
  _event: Electron.IpcMainInvokeEvent,
  gameId: number
) => {
  const game = await gameRepository.findOne({ where: { id: gameId } });

  if (!game) return;

  const gamePath = path.join(
    game.downloadPath ?? (await getDownloadsPath()),
    game.folderName
  );

  if (fs.existsSync(gamePath)) {
    const setupPath = path.join(gamePath, "setup.exe");
    if (fs.existsSync(setupPath)) {
      shell.openExternal(setupPath);
    } else {
      shell.openPath(gamePath);
    }
  } else {
    await gameRepository.delete({
      id: gameId,
    });
  }
};

registerEvent(openGame, {
  name: "openGame",
});
