import { gamesSublevel, levelKeys } from "@main/level";

export const clearGamesRemoteIds = async () => {
  const games = await gamesSublevel.values().all();

  await gamesSublevel.batch(
    games.map((game) => ({
      type: "put",
      key: levelKeys.game(game.shop, game.objectId),
      value: {
        ...game,
        remoteId: null,
      },
    }))
  );
};
