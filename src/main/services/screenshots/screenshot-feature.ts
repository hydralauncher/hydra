import { db, levelKeys } from "@main/level";

import { HydraApi } from "../hydra-api";
import { logger } from "../logger";

const SCREENSHOTS_FEATURE = "SCREENSHOTS";
const FEATURE_CACHE_TTL_MS = 10 * 60_000;
const FEATURE_REQUEST_TIMEOUT_MS = 5_000;

type ScreenshotsFeatureListener = (enabled: boolean) => void;

let cachedValue: { enabled: boolean; fetchedAt: number } | null = null;
let inFlight: Promise<boolean> | null = null;
const listeners = new Set<ScreenshotsFeatureListener>();

const setCachedValue = (enabled: boolean, fetchedAt: number) => {
  const changed = cachedValue !== null && cachedValue.enabled !== enabled;
  cachedValue = { enabled, fetchedAt };
  if (!changed) return;

  for (const listener of listeners) {
    try {
      listener(enabled);
    } catch (error) {
      logger.error("Screenshots feature flag listener failed", error);
    }
  }
};

const readPersistedValue = () =>
  db
    .get<string, boolean | undefined>(levelKeys.screenshotsFeatureEnabled, {
      valueEncoding: "json",
    })
    .then((enabled) => enabled ?? false)
    .catch(() => false);

const fetchFeatureFlag = async () => {
  try {
    const features = await HydraApi.get<unknown>("/features", undefined, {
      needsAuth: false,
      timeout: FEATURE_REQUEST_TIMEOUT_MS,
    });
    const enabled =
      Array.isArray(features) && features.includes(SCREENSHOTS_FEATURE);
    setCachedValue(enabled, performance.now());
    await db
      .put(levelKeys.screenshotsFeatureEnabled, enabled, {
        valueEncoding: "json",
      })
      .catch(() => undefined);
    return enabled;
  } catch (error) {
    logger.warn("Could not refresh the screenshots feature flag", error);
    const persisted = cachedValue?.enabled ?? (await readPersistedValue());
    setCachedValue(persisted, Number.NEGATIVE_INFINITY);
    return persisted;
  }
};

const refreshFeatureFlag = () => {
  inFlight ??= fetchFeatureFlag().finally(() => {
    inFlight = null;
  });
  return inFlight;
};

export const isScreenshotsFeatureEnabled = async () => {
  if (!cachedValue) return refreshFeatureFlag();

  if (performance.now() - cachedValue.fetchedAt >= FEATURE_CACHE_TTL_MS) {
    void refreshFeatureFlag();
  }
  return cachedValue.enabled;
};

export const onScreenshotsFeatureChange = (
  listener: ScreenshotsFeatureListener
) => {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
};
