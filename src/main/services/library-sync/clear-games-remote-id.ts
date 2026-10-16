import { gamesSublevel, levelKeys } from "@main/level";
import { libraryWriteQueue } from "./library-write-queue";
import { resetAccountScopedGameState } from "./game-visibility";

export const clearGamesRemoteIds = async (
  current: () => boolean = () => true
) =>
  libraryWriteQueue.run(async () => {
    if (!current()) return;
    const games = await gamesSublevel.values().all();

    if (!current()) return;
    await gamesSublevel.batch(
      games.map((game) => ({
        type: "put",
        key: levelKeys.game(game.shop, game.objectId),
        value: resetAccountScopedGameState(game),
      }))
    );
  });
