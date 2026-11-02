/**
 * The API allows 20 messages per 10 seconds per user, counted in fixed
 * windows: the first send after a window ends opens the next one. A 429 does
 * not say when the window ends, so the client tracks the window itself.
 */
export const CHAT_RATE_LIMIT_WINDOW_MS = 10_000;

/** Floor for the countdown, so a late 429 still shows the user something. */
const MIN_COOLDOWN_MS = 1_000;

export interface ChatSendCooldown {
  startedAt: number;
  until: number;
}

/** Start of the window a send at `now` falls into. */
export const getRateLimitWindowStart = (
  windowStart: number | null,
  now: number
) =>
  windowStart !== null && now - windowStart < CHAT_RATE_LIMIT_WINDOW_MS
    ? windowStart
    : now;

/** Cooldown after a send in the window opened at `windowStart` hit the limit. */
export const createSendCooldown = (
  windowStart: number,
  now: number
): ChatSendCooldown => ({
  startedAt: now,
  until: Math.max(
    windowStart + CHAT_RATE_LIMIT_WINDOW_MS,
    now + MIN_COOLDOWN_MS
  ),
});
