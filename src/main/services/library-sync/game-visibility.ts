import type { Game } from "@types";

export const belongsToLibraryCollection = (
  game: Pick<Game, "isDeleted" | "isHidden">,
  collection: "visible" | "hidden"
) => !game.isDeleted && Boolean(game.isHidden) === (collection === "hidden");

export const resetAccountScopedGameState = (game: Game): Game => ({
  ...game,
  remoteId: null,
  hide: false,
  isHidden: false,
});
