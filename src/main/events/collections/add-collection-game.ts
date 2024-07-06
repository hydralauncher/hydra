import { collectionRepository } from "@main/repository";

import { registerEvent } from "../register-event";
import { Collection, Game } from "@main/entity";

const addCollectionGame = async (
  _event: Electron.IpcMainInvokeEvent,
  collectionId: number,
  game: Game
) => {
  return await collectionRepository
    .createQueryBuilder()
    .relation(Collection, "games")
    .of(collectionId)
    .add(game);
};

registerEvent("addCollectionGame", addCollectionGame);
