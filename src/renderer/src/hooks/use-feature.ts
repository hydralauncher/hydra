import { useEffect, useState, useCallback } from "react";

import { logger } from "@renderer/logger";
import { ensureArray } from "@renderer/helpers";

enum Feature {
  CheckDownloadWritePermission = "CHECK_DOWNLOAD_WRITE_PERMISSION",
  TorBox = "TORBOX",
  Premiumize = "PREMIUMIZE",
  AllDebrid = "ALLDEBRID",
  Nimbus = "NIMBUS",
  NimbusPreview = "NIMBUS_PREVIEW",
  ChatImages = "CHAT_IMAGES",
  Screenshots = "SCREENSHOTS",
  ScreenshotComments = "SCREENSHOT_COMMENTS",
  GameLeaderboardsExtended = "GAME_LEADERBOARDS_EXTENDED",
  GlobalLeaderboards = "GLOBAL_LEADERBOARDS",
  LeaderboardReports = "LEADERBOARD_REPORTS",
  MultipartHosterDownloads = "MULTIPART_HOSTER_DOWNLOADS",
  LeaderboardBadges = "LEADERBOARD_BADGES",
}

const readCachedFeatures = (): string[] => {
  try {
    const parsed = JSON.parse(localStorage.getItem("features") ?? "[]");
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
};

export function useFeature() {
  const [features, setFeatures] = useState<string[] | null>(null);

  useEffect(() => {
    window.electron.hydraApi
      .get<string[]>("/features", { needsAuth: false })
      .then((response) => {
        const safeFeatures = ensureArray<string>(response, "/features");
        localStorage.setItem("features", JSON.stringify(safeFeatures));
        setFeatures(safeFeatures);
      })
      .catch(logger.error);
  }, []);

  const isFeatureEnabled = useCallback(
    (feature: Feature) => {
      return (features ?? readCachedFeatures()).includes(feature);
    },
    [features]
  );

  return {
    isFeatureEnabled,
    isFeaturesLoaded: features !== null,
    Feature,
  };
}
