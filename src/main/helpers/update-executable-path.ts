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

export function updateGameTrackingExecutablePaths<TGame extends Game>(
  game: TGame,
  trackingExecutablePaths: string[]
): TGame {
  return {
    ...game,
    trackingExecutablePaths,
    trackingExecutablePathsUpdatedAt: trackingExecutablePaths.length
      ? new Date()
      : null,
  };
}
