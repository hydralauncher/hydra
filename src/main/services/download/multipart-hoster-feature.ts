import { MULTIPART_HOSTER_DOWNLOADS_FEATURE } from "@shared";
import { HydraApi } from "../hydra-api";
import { logger } from "../logger";

const FEATURES_REQUEST_TIMEOUT_MS = 10_000;

// Fails closed: without an answer from the API, the feature stays off.
export const isMultipartHosterDownloadsEnabled = () =>
  HydraApi.get<string[]>("/features", null, {
    needsAuth: false,
    timeout: FEATURES_REQUEST_TIMEOUT_MS,
  })
    .then(
      (features) =>
        Array.isArray(features) &&
        features.includes(MULTIPART_HOSTER_DOWNLOADS_FEATURE)
    )
    .catch((error) => {
      logger.warn("[DownloadManager] Could not load feature flags", error);
      return false;
    });

export const assertMultipartHosterDownloadsEnabled = async () => {
  if (!(await isMultipartHosterDownloadsEnabled())) {
    throw new Error("Multi-part hoster downloads are turned off.");
  }
};
