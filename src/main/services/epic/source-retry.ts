import { EpicIntegrationError } from "./auth-protocol.js";
import {
  EPIC_MAX_BACKOFF_MS,
  EPIC_NETWORK_ATTEMPTS,
  EPIC_NETWORK_BACKOFF_MS,
  EPIC_RATE_LIMIT_ATTEMPTS,
  EPIC_RATE_LIMIT_BACKOFF_MS,
} from "./constants.js";

export function epicAbort(signal: AbortSignal) {
  if (signal.aborted) throw new EpicIntegrationError("operation-cancelled");
}
export function epicWait(ms: number, signal: AbortSignal): Promise<void> {
  epicAbort(signal);
  return new Promise((resolve, reject) => {
    const abort = () => {
      clearTimeout(timer);
      signal.removeEventListener("abort", abort);
      reject(new EpicIntegrationError("operation-cancelled"));
    };
    const timer = setTimeout(() => {
      signal.removeEventListener("abort", abort);
      resolve();
    }, ms);
    signal.addEventListener("abort", abort, { once: true });
    if (signal.aborted) abort();
  });
}
export function epicRetryAfter(
  value: string | null,
  now = Date.now()
): number | null {
  if (!value) return null;
  const seconds = Number(value);
  if (Number.isFinite(seconds) && seconds >= 0) return seconds * 1000;
  const date = Date.parse(value);
  return Number.isFinite(date) ? Math.max(0, date - now) : null;
}
export async function fetchEpicWithRetry(
  request: () => Promise<Response>,
  signal: AbortSignal,
  refresh: () => Promise<void>,
  wait = epicWait
): Promise<Response> {
  let refreshed = false,
    network = 0,
    rate = 0;
  for (;;) {
    epicAbort(signal);
    let response: Response;
    try {
      response = await request();
    } catch (error) {
      epicAbort(signal);
      if (++network >= EPIC_NETWORK_ATTEMPTS)
        throw new EpicIntegrationError("network");
      if (error instanceof EpicIntegrationError) throw error;
      await wait(EPIC_NETWORK_BACKOFF_MS * 2 ** (network - 1), signal);
      continue;
    }
    if (response.ok) return response;
    if (response.status === 401 && !refreshed) {
      refreshed = true;
      await response.body?.cancel();
      await refresh();
      continue;
    }
    if (response.status === 401)
      throw new EpicIntegrationError("session-expired");
    if (response.status === 403)
      throw new EpicIntegrationError("source-permission");
    if (response.status === 429 && ++rate < EPIC_RATE_LIMIT_ATTEMPTS) {
      const delay =
        epicRetryAfter(response.headers.get("retry-after")) ??
        Math.min(
          EPIC_MAX_BACKOFF_MS,
          EPIC_RATE_LIMIT_BACKOFF_MS * 2 ** (rate - 1)
        );
      await response.body?.cancel();
      await wait(delay, signal);
      continue;
    }
    if (
      [500, 502, 503, 504].includes(response.status) &&
      ++network < EPIC_NETWORK_ATTEMPTS
    ) {
      await response.body?.cancel();
      await wait(EPIC_NETWORK_BACKOFF_MS * 2 ** (network - 1), signal);
      continue;
    }
    await response.body?.cancel();
    throw new EpicIntegrationError(
      response.status === 429 ? "rate-limit" : "api-unavailable"
    );
  }
}
