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

// Offline errors never reach the server and 401 already resets the session.
const isServerFailure = (error: unknown) => {
  if (!isAxiosError(error)) return false;
  const status = error.response?.status;
  if (status !== undefined) return status >= 400 && status !== 401;
  return error.code === "ECONNABORTED" || error.code === "ETIMEDOUT";
};

const recordFailure = (
  key: string,
  shop: GameShop,
  objectId: string,
  error: unknown
) => {
  const now = Date.now();
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
    isAxiosError(error) ? (error.response?.status ?? error.code) : undefined,
    delay
  );
};

const fetch = <T>(
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
  if (pending) return pending as Promise<T | null>;

  const promise = request()
    .then((value) => {
      failures.delete(key);
      return value;
    })
    .catch((error: unknown) => {
      if (isServerFailure(error)) recordFailure(key, shop, objectId, error);
      return null;
    })
    .finally(() => {
      if (inFlight.get(requestKey) === promise) inFlight.delete(requestKey);
    });
  inFlight.set(requestKey, promise);
  return promise;
};

export const CombinedAchievementsRequests = {
  fetch,

  clear() {
    failures.clear();
    inFlight.clear();
  },
};
