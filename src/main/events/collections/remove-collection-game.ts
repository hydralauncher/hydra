import { collectionRepository } from "@main/repository";

import { registerEvent } from "../register-event";
import { Collection, Game } from "@main/entity";

const removeCollectionGame = async (
  _event: Electron.IpcMainInvokeEvent,
  collectionId: number,
  game: Game
) => {
  return await collectionRepository
    .createQueryBuilder()
    .relation(Collection, "games")
    .of(collectionId)
    .remove(game);
};

registerEvent("removeCollectionGame", removeCollectionGame);
