import { gameRepository } from "@main/repository";

export const clearGamesRemoteIds = () => {
  return gameRepository.update({}, { remoteId: null });
};
