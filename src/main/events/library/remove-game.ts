import { registerEvent } from "../register-event";
import { gameRepository } from "../../repository";
import { GameStatus } from "@main/constants";

const removeGame = async (
  _event: Electron.IpcMainInvokeEvent,
  gameId: number
) => {
  await gameRepository.update(
    {
      id: gameId,
      status: GameStatus.Cancelled,
    },
    {
      status: null,
      downloadPath: null,
      bytesDownloaded: 0,
      progress: 0,
    }
  );
};

registerEvent(removeGame, {
  name: "removeGame",
});
