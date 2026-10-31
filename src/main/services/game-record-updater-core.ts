import type { Game } from "@types";

interface GameStore {
  get(gameKey: string): Promise<Game | undefined>;
  put(gameKey: string, game: Game): Promise<unknown>;
}

type GamePatch = Partial<Game> | ((game: Game) => Partial<Game>);

export const createGameRecordUpdater = (store: GameStore) => {
  const pendingUpdates = new Map<string, Promise<void>>();

  return async (gameKey: string, patch: GamePatch) => {
    const previousUpdate = pendingUpdates.get(gameKey) ?? Promise.resolve();
    let updatedGame: Game | undefined;

    const update = previousUpdate.then(async () => {
      const game = await store.get(gameKey);
      if (!game || game.isDeleted) return;

      updatedGame = {
        ...game,
        ...(typeof patch === "function" ? patch(game) : patch),
      };

      await store.put(gameKey, updatedGame);
    });

    const updateTail = update.then(
      () => undefined,
      () => undefined
    );
    pendingUpdates.set(gameKey, updateTail);

    try {
      await update;
      return updatedGame;
    } finally {
      if (pendingUpdates.get(gameKey) === updateTail) {
        pendingUpdates.delete(gameKey);
      }
    }
  };
};
