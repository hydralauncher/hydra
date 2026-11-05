import { HydraApi } from "@main/services/hydra-api";
import { logger } from "@main/services/logger";

const RECOMPILATION_CLOUD_SAVES_FEATURE = "RECOMPILATION_CLOUD_SAVES";
const FEATURE_CACHE_TTL_MS = 10 * 60_000;
const FEATURE_REQUEST_TIMEOUT_MS = 5_000;

let cachedCloudSaves: { enabled: boolean; fetchedAt: number } | null = null;

export const isRecompilationCloudSaveEnabled = async () => {
  if (
    cachedCloudSaves &&
    performance.now() - cachedCloudSaves.fetchedAt < FEATURE_CACHE_TTL_MS
  ) {
    return cachedCloudSaves.enabled;
  }

  try {
    const features = await HydraApi.get<unknown>("/features", undefined, {
      needsAuth: false,
      timeout: FEATURE_REQUEST_TIMEOUT_MS,
    });
    const enabled =
      Array.isArray(features) &&
      features.includes(RECOMPILATION_CLOUD_SAVES_FEATURE);
    cachedCloudSaves = { enabled, fetchedAt: performance.now() };
    return enabled;
  } catch (error) {
    logger.warn("Could not load the recompilation cloud save flag", error);
    return false;
  }
};
