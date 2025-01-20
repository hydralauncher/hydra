import { Not } from "typeorm";

import { registerEvent } from "../register-event";

import { DownloadManager } from "@main/services";
import { dataSource } from "@main/data-source";

const resumeGameDownload = async (
  _event: Electron.IpcMainInvokeEvent,
  gameId: number
) => {
  const game = await gameRepository.findOne({
    where: {
      id: gameId,
      isDeleted: false,
    },
  });

  if (!game) return;

  if (game.status === "paused") {
    await dataSource.transaction(async (transactionalEntityManager) => {
      await DownloadManager.pauseDownload();

      await transactionalEntityManager
        .getRepository(Game)
        .update({ status: "active", progress: Not(1) }, { status: "paused" });

      await DownloadManager.resumeDownload(game);

      await transactionalEntityManager
        .getRepository(DownloadQueue)
        .delete({ game: { id: gameId } });

      await transactionalEntityManager
        .getRepository(DownloadQueue)
        .insert({ game: { id: gameId } });

      await transactionalEntityManager
        .getRepository(Game)
        .update({ id: gameId }, { status: "active" });
    });
  }
};

registerEvent("resumeGameDownload", resumeGameDownload);
