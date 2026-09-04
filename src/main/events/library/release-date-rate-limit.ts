import type { SteamAppDetailsRequestResult } from "@main/services/steam";

export const RATE_LIMIT_FALLBACK_DELAY_MS = 60 * 60 * 1000;

export const getRateLimitDelay = (results: SteamAppDetailsRequestResult[]) =>
  Math.max(
    0,
    ...results.map((result) =>
      result.type === "rate_limited"
        ? (result.retryAfterMs ?? RATE_LIMIT_FALLBACK_DELAY_MS)
        : 0
    )
  );
