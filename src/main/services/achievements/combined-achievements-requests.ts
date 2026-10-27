import { isAxiosError } from "axios";
import type { GameShop } from "@types";
import type { HydraApiAuthContext } from "../hydra-auth-context";
import { achievementsLogger } from "../logger";
import { getRetryAfterMs } from "./retry-after";

export const COMBINED_ACHIEVEMENTS_BACKOFF_STEPS_MS = [
  60_000,
  5 * 60_000,
  30 * 60_000,
];
const MAX_BACKOFF_MS = COMBINED_ACHIEVEMENTS_BACKOFF_STEPS_MS.at(-1)!;

interface Failure {
  attempts: number;
  retryAt: number;
}

const failures = new Map<string, Failure>();
const inFlight = new Map<string, Promise<unknown>>();
let epoch = 0;

const errorCode = (error: unknown) =>
  error instanceof Error && "code" in error ? error.code : undefined;

// Offline errors never reach the server and 401 already resets the session.
// HydraApi rethrows errors without a response as plain Errors that keep the code.
const isServerFailure = (error: unknown) => {
  const status = isAxiosError(error) ? error.response?.status : undefined;
  if (status !== undefined) return status >= 400 && status !== 401;
  const code = errorCode(error);
  return code === "ECONNABORTED" || code === "ETIMEDOUT";
};

const recordFailure = (
  key: string,
  shop: GameShop,
  objectId: string,
  error: unknown
) => {
  const now = Date.now();
  // Deliberate decay: a game left alone for 30 min past its backoff starts
  // over at the first step, which also keeps the map small.
  for (const [failureKey, failure] of failures)
    if (failure.retryAt + MAX_BACKOFF_MS <= now) failures.delete(failureKey);

  const attempts = (failures.get(key)?.attempts ?? 0) + 1;
  const step =
    COMBINED_ACHIEVEMENTS_BACKOFF_STEPS_MS[
      Math.min(attempts, COMBINED_ACHIEVEMENTS_BACKOFF_STEPS_MS.length) - 1
    ];
  const delay = Math.min(
    MAX_BACKOFF_MS,
    Math.max(step, getRetryAfterMs(error))
  );
  failures.set(key, { attempts, retryAt: now + delay });
  achievementsLogger.warn(
    "Combined achievements unavailable, backing off",
    shop,
    objectId,
    (isAxiosError(error) ? error.response?.status : undefined) ??
      errorCode(error),
    delay
  );
};

// Callers sharing an in-flight request receive the same object; treat it as read-only.
const fetchCombined = <T>(
  context: HydraApiAuthContext | null,
  shop: GameShop,
  objectId: string,
  language: string,
  request: () => Promise<T>
): Promise<T | null> => {
  if (!context) return request().catch(() => null);

  const key = JSON.stringify([
    context.environment,
    context.userId,
    shop,
    objectId,
  ]);
  if ((failures.get(key)?.retryAt ?? 0) > Date.now())
    return Promise.resolve(null);

  const requestKey = JSON.stringify([key, language]);
  const pending = inFlight.get(requestKey);
  if (pending !== undefined) return pending as Promise<T | null>;

  // A request started before clear() must not touch the new session's state.
  const startedIn = epoch;
  const promise = request()
    .then((value) => {
      if (startedIn === epoch) failures.delete(key);
      return value;
    })
    .catch((error: unknown) => {
      if (startedIn === epoch && isServerFailure(error))
        recordFailure(key, shop, objectId, error);
      return null;
    })
    .finally(() => {
      if (inFlight.get(requestKey) === promise) inFlight.delete(requestKey);
    });
  inFlight.set(requestKey, promise);
  return promise;
};

export const CombinedAchievementsRequests = {
  fetch: fetchCombined,

  clear() {
    epoch++;
    failures.clear();
    inFlight.clear();
  },
};
