import type { Game } from "@types";

type RunningSession = { firstTick: number };
const gameKey = (game: Game) => `${game.shop}:${game.objectId}`;

export const resolveActiveOverlayGame = (
  games: Game[],
  sessions: ReadonlyMap<string, RunningSession>,
  activeGame: Game | null
) => {
  if (activeGame && sessions.has(gameKey(activeGame))) {
    return activeGame;
  }

  return (
    games
      .filter((game) => sessions.has(gameKey(game)))
      .sort(
        (left, right) =>
          (sessions.get(gameKey(right))?.firstTick ?? 0) -
          (sessions.get(gameKey(left))?.firstTick ?? 0)
      )[0] ?? null
  );
};
