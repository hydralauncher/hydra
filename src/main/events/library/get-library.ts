import { gameRepository } from "@main/repository";
import { GameStatus } from "@main/constants";

import { searchRepacks } from "../helpers/search-games";
import { registerEvent } from "../register-event";
import { sortBy } from "lodash-es";

const getLibrary = async () =>
  gameRepository
    .find({
      where: {
        isDeleted: false,
      },
      order: {
        createdAt: "desc",
      },
      relations: {
        repack: true,
      },
    })
    .then((games) =>
      sortBy(
        games.map((game) => ({
          ...game,
          repacks: searchRepacks(game.title),
        })),
        ['title']
      )
    );

registerEvent(getLibrary, {
  name: "getLibrary",
});

