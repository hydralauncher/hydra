import { registerEvent } from "../register-event";
import { gameRepository } from "../../repository";
import { DownloadManager } from "@main/services";

const pauseGameDownload = async (
  _event: Electron.IpcMainInvokeEvent,
  gameId: number
) => {
  await DownloadManager.pauseDownload();
  await gameRepository.update({ id: gameId }, { status: "paused" });
};

registerEvent("pauseGameDownload", pauseGameDownload);
