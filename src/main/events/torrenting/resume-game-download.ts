import { registerEvent } from "../register-event";
import { gameRepository } from "../../repository";

import { DownloadManager } from "@main/services";

const resumeGameDownload = async (
  _event: Electron.IpcMainInvokeEvent,
  gameId: number
) => {
  const game = await gameRepository.findOne({
    where: {
      id: gameId,
      isDeleted: false,
    },
    relations: { repack: true },
  });

  if (!game) return;

  if (game.status === "paused") {
    await DownloadManager.pauseDownload();

    await gameRepository.update({ status: "active" }, { status: "paused" });

    await DownloadManager.resumeDownload(gameId);
  }
};

registerEvent("resumeGameDownload", resumeGameDownload);
