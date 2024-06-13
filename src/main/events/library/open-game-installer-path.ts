import { shell } from "electron";
import path from "node:path";
import { gameRepository } from "@main/repository";
import { getDownloadsPath } from "../helpers/get-downloads-path";
import { registerEvent } from "../register-event";

const openGameInstallerPath = async (
  _event: Electron.IpcMainInvokeEvent,
  gameId: number
) => {
  const game = await gameRepository.findOne({
    where: { id: gameId, isDeleted: false },
  });

  if (!game || !game.folderName || !game.downloadPath) return true;

  const gamePath = path.join(
    game.downloadPath ?? (await getDownloadsPath()),
    game.folderName!
  );

  shell.showItemInFolder(gamePath);

  return true;
};

registerEvent("openGameInstallerPath", openGameInstallerPath);
