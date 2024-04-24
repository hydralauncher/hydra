import { GameStatus } from "@main/constants";
import { gameRepository } from "@main/repository";

import { registerEvent } from "../register-event";

const removeGameFromDownload = async (
  _event: Electron.IpcMainInvokeEvent,
  gameId: number
) => {
  const game = await gameRepository.findOne({
    where: {
      id: gameId,
      status: GameStatus.Cancelled,
    },
  });

  if (!game) return;

  gameRepository.update(
    {
      id: game.id,
    },
    {
      status: null,
      downloadPath: null,
      bytesDownloaded: 0,
      progress: 0,
    }
  );
};

registerEvent(removeGameFromDownload, {
  name: "removeGameFromDownload",
});
