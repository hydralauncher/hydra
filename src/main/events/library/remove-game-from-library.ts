import { registerEvent } from "../register-event";
import { gameRepository } from "../../repository";
import { HydraApi, logger } from "@main/services";

const removeGameFromLibrary = async (
  _event: Electron.IpcMainInvokeEvent,
  gameId: number
) => {
  gameRepository.update(
    { id: gameId },
    { isDeleted: true, executablePath: null }
  );

  removeRemoveGameFromLibrary(gameId).catch((err) => {
    logger.error("removeRemoveGameFromLibrary", err);
  });
};

const removeRemoveGameFromLibrary = async (gameId: number) => {
  const game = await gameRepository.findOne({ where: { id: gameId } });

  if (game?.remoteId) {
    HydraApi.delete(`/games/${game.remoteId}`).catch(() => {});
  }
};

registerEvent("removeGameFromLibrary", removeGameFromLibrary);
