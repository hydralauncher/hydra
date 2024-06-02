import { gameRepository } from "@main/repository";

import { registerEvent } from "../register-event";

import { DownloadManager } from "@main/services";

const cancelGameDownload = async (
  _event: Electron.IpcMainInvokeEvent,
  gameId: number
) => {
  await DownloadManager.cancelDownload(gameId);

  await gameRepository.update(
    {
      id: gameId,
    },
    {
      status: "removed",
      bytesDownloaded: 0,
      progress: 0,
    }
  );
};

registerEvent("cancelGameDownload", cancelGameDownload);
