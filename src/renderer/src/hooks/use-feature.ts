import { useEffect, useState, useCallback } from "react";

import { logger } from "@renderer/logger";
import { ensureArray } from "@renderer/helpers";

export enum Feature {
  CheckDownloadWritePermission = "CHECK_DOWNLOAD_WRITE_PERMISSION",
  TorBox = "TORBOX",
  Premiumize = "PREMIUMIZE",
  AllDebrid = "ALLDEBRID",
  Nimbus = "NIMBUS",
  NimbusPreview = "NIMBUS_PREVIEW",
  ChatImages = "CHAT_IMAGES",
  Gamification = "GAMIFICATION",
  GamificationShop = "GAMIFICATION_SHOP",
  Screenshots = "SCREENSHOTS",
  ScreenshotComments = "SCREENSHOT_COMMENTS",
  GameLeaderboardsExtended = "GAME_LEADERBOARDS_EXTENDED",
  GlobalLeaderboards = "GLOBAL_LEADERBOARDS",
  LeaderboardReports = "LEADERBOARD_REPORTS",
  MultipartHosterDownloads = "MULTIPART_HOSTER_DOWNLOADS",
  LeaderboardBadges = "LEADERBOARD_BADGES",
  Recompilations = "RECOMPILATIONS",
  RecompilationCloudSaves = "RECOMPILATION_CLOUD_SAVES",
}

export const readCachedFeatures = (): string[] => {
  try {
    const parsed = JSON.parse(localStorage.getItem("features") ?? "[]");
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
};

const FEATURE_REFRESH_INTERVAL_MS = 60_000;

let latestFeatures: string[] | null = null;
let latestFeaturesAt = 0;
let featuresRequest: Promise<string[]> | null = null;
const featureListeners = new Set<(features: string[]) => void>();

const loadFeatures = () => {
  if (featuresRequest !== null) return featuresRequest;

  if (
    latestFeatures &&
    Date.now() - latestFeaturesAt < FEATURE_REFRESH_INTERVAL_MS
  ) {
    return Promise.resolve(latestFeatures);
  }

  featuresRequest = window.electron.hydraApi
    .get<string[]>("/features", { needsAuth: false })
    .then((response) => {
      const safeFeatures = ensureArray<string>(response, "/features");
      latestFeatures = safeFeatures;
      latestFeaturesAt = Date.now();
      localStorage.setItem("features", JSON.stringify(safeFeatures));
      return safeFeatures;
    })
    .catch((error) => {
      latestFeaturesAt = 0;
      logger.error(error);
      throw error;
    })
    .finally(() => {
      featuresRequest = null;
    });

  return featuresRequest;
};

export function useFeature() {
  const [features, setFeatures] = useState<string[] | null>(latestFeatures);
  const [hasFeaturesFailed, setHasFeaturesFailed] = useState(false);

  useEffect(() => {
    let cancelled = false;

    const listener = (nextFeatures: string[]) => {
      if (cancelled) return;
      setFeatures(nextFeatures);
    };

    featureListeners.add(listener);

    if (latestFeatures) {
      setFeatures(latestFeatures);
    }

    void loadFeatures()
      .then((nextFeatures) => {
        for (const featureListener of featureListeners) {
          featureListener(nextFeatures);
        }
      })
      .catch(() => {
        if (!cancelled) setHasFeaturesFailed(true);
      });

    return () => {
      cancelled = true;
      featureListeners.delete(listener);
    };
  }, []);

  const isFeatureEnabled = useCallback(
    (feature: Feature) => {
      return (features ?? latestFeatures ?? readCachedFeatures()).includes(
        feature
      );
    },
    [features]
  );

  return {
    isFeatureEnabled,
    isFeaturesLoaded: features !== null,
    isFeaturesSettled: features !== null || hasFeaturesFailed,
    Feature,
  };
}
