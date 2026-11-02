import type { Game } from "@types";
/** A stale preference/file callback must not expose another account's import. */
export function getContextualEpicGame(
  game: Game,
  context: { environment: string; userId: string } | null
): Game {
  if (
    !game.hasActiveEpicImport &&
    !game.epicPlayTimeInMilliseconds &&
    !game.epicImportScope &&
    game.source !== "epic"
  )
    return game;
  const scope = game.epicImportScope;
  if (
    context &&
    scope?.environment === context.environment &&
    scope.userId === context.userId
  )
    return game;
  return {
    ...game,
    hasActiveEpicImport: false,
    epicPlayTimeInMilliseconds: 0,
    epicImportScope: undefined,
    ...(game.source === "epic" ? { isDeleted: true } : {}),
  };
}
