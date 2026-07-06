import { useEffect, useState, useCallback } from "react";

import { logger } from "@renderer/logger";

enum Feature {
  CheckDownloadWritePermission = "CHECK_DOWNLOAD_WRITE_PERMISSION",
  TorBox = "TORBOX",
  Premiumize = "PREMIUMIZE",
  AllDebrid = "ALLDEBRID",
  Nimbus = "NIMBUS",
  NimbusPreview = "NIMBUS_PREVIEW",
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
        const safeFeatures = Array.isArray(response) ? response : [];
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
    Feature,
  };
}
