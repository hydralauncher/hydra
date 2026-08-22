import type { Game } from "@types";

const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;

export const RELEASE_DATE_RECHECK_INTERVALS = {
  transientError: HOUR_MS,
  comingSoon: 7 * DAY_MS,
  unavailable: 30 * DAY_MS,
} as const;

type ReleaseDateCheckableGame = Pick<
  Game,
  "releaseDateTimestamp" | "releaseDateNextCheckAt"
>;

export const needsReleaseDateRefresh = (
  game: ReleaseDateCheckableGame,
  now: number
): boolean => {
  if (game.releaseDateTimestamp && game.releaseDateTimestamp > 0) return false;

  return (
    game.releaseDateNextCheckAt === undefined ||
    game.releaseDateNextCheckAt <= now
  );
};

export const getReleaseDateNextCheckAt = ({
  now,
  result,
  retryAfterMs,
}: {
  now: number;
  result: "coming_soon" | "not_found" | "error" | "rate_limited";
  retryAfterMs?: number | null;
}): number => {
  if (result === "coming_soon") {
    return now + RELEASE_DATE_RECHECK_INTERVALS.comingSoon;
  }

  if (result === "not_found") {
    return now + RELEASE_DATE_RECHECK_INTERVALS.unavailable;
  }

  if (result === "rate_limited" && retryAfterMs != null) {
    return (
      now +
      Math.max(retryAfterMs, RELEASE_DATE_RECHECK_INTERVALS.transientError)
    );
  }

  return now + RELEASE_DATE_RECHECK_INTERVALS.transientError;
};
