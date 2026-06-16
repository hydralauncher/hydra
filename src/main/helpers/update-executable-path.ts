import type { Game } from "@types";

export function updateGameExecutablePath<TGame extends Game>(
  game: TGame,
  executablePath: string | null
): TGame {
  if (game.executablePath === executablePath) {
    return game;
  }

  return {
    ...game,
    executablePath,
    executablePathUpdatedAt: executablePath ? new Date() : null,
  };
}
