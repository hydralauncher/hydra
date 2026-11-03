interface RunningGameSnapshot {
  id: string;
  sessionDurationInMillis: number;
}

export function hasSameRunningGames(
  current: Record<string, RunningGameSnapshot>,
  games: RunningGameSnapshot[]
) {
  if (Object.keys(current).length !== games.length) return false;

  return games.every(
    (game) =>
      current[game.id]?.sessionDurationInMillis === game.sessionDurationInMillis
  );
}
