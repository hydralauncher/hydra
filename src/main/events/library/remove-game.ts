import { registerEvent } from "../register-event";
import { gameRepository } from "../../repository";

const removeGame = async (
  _event: Electron.IpcMainInvokeEvent,
  gameId: number
) => {
  await gameRepository.update(
    {
      id: gameId,
      status: "removed",
    },
    {
      status: null,
      downloadPath: null,
      bytesDownloaded: 0,
      progress: 0,
    }
  );
};

registerEvent("removeGame", removeGame);
