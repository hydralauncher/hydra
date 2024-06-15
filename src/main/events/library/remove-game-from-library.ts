import { registerEvent } from "../register-event";
import { gameRepository } from "../../repository";
import { HydraApi } from "@main/services/hydra-api";

const removeGameFromLibrary = async (
  _event: Electron.IpcMainInvokeEvent,
  gameId: number
) => {
  gameRepository.update(
    { id: gameId },
    { isDeleted: true, executablePath: null }
  );

  const game = await gameRepository.findOne({ where: { id: gameId } });

  if (game?.remoteId) {
    HydraApi.delete(`/games/${game.remoteId}`);
  }
};

registerEvent("removeGameFromLibrary", removeGameFromLibrary);
