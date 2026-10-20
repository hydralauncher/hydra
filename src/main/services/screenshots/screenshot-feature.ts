import { db, levelKeys } from "@main/level";

import { HydraApi } from "../hydra-api";
import { logger } from "../logger";

const SCREENSHOTS_FEATURE = "SCREENSHOTS";
const FEATURE_CACHE_TTL_MS = 10 * 60_000;
const FEATURE_REQUEST_TIMEOUT_MS = 5_000;

let cachedValue: { enabled: boolean; fetchedAt: number } | null = null;
let inFlight: Promise<boolean> | null = null;

const readPersistedValue = () =>
  db
    .get<string, boolean>(levelKeys.screenshotsFeatureEnabled, {
      valueEncoding: "json",
    })
    .catch(() => false);

const fetchFeatureFlag = async () => {
  try {
    const features = await HydraApi.get<unknown>("/features", undefined, {
      needsAuth: false,
      timeout: FEATURE_REQUEST_TIMEOUT_MS,
    });
    const enabled =
      Array.isArray(features) && features.includes(SCREENSHOTS_FEATURE);
    cachedValue = { enabled, fetchedAt: Date.now() };
    await db
      .put(levelKeys.screenshotsFeatureEnabled, enabled, {
        valueEncoding: "json",
      })
      .catch(() => undefined);
    return enabled;
  } catch (error) {
    logger.warn("Could not refresh the screenshots feature flag", error);
    const persisted = cachedValue?.enabled ?? (await readPersistedValue());
    cachedValue = { enabled: persisted, fetchedAt: Date.now() };
    return persisted;
  }
};

export const isScreenshotsFeatureEnabled = async () => {
  if (cachedValue && Date.now() - cachedValue.fetchedAt < FEATURE_CACHE_TTL_MS)
    return cachedValue.enabled;

  inFlight ??= fetchFeatureFlag().finally(() => {
    inFlight = null;
  });
  return inFlight;
};

export const markScreenshotsFeatureDisabled = () => {
  cachedValue = { enabled: false, fetchedAt: Date.now() };
};
