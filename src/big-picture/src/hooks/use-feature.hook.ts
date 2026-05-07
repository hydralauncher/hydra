import { useCallback, useEffect, useState } from "react";

export enum Feature {
  CheckDownloadWritePermission = "CHECK_DOWNLOAD_WRITE_PERMISSION",
  TorBox = "TORBOX",
  Premiumize = "PREMIUMIZE",
  AllDebrid = "ALLDEBRID",
  Nimbus = "NIMBUS",
  NimbusPreview = "NIMBUS_PREVIEW",
}

const FEATURES_STORAGE_KEY = "features";

function getStoredFeatures() {
  try {
    return JSON.parse(
      globalThis.window.localStorage.getItem(FEATURES_STORAGE_KEY) ?? "[]"
    ) as string[];
  } catch {
    return [];
  }
}

export function useFeature() {
  const [features, setFeatures] = useState<string[] | null>(() => {
    return getStoredFeatures();
  });

  useEffect(() => {
    globalThis.window.electron.hydraApi
      .get<string[]>("/features", { needsAuth: false })
      .then((resolvedFeatures) => {
        const nextFeatures = resolvedFeatures ?? [];
        globalThis.window.localStorage.setItem(
          FEATURES_STORAGE_KEY,
          JSON.stringify(nextFeatures)
        );
        setFeatures(nextFeatures);
      })
      .catch(() => {
        setFeatures(
          (currentFeatures) => currentFeatures ?? getStoredFeatures()
        );
      });
  }, []);

  const isFeatureEnabled = useCallback(
    (feature: Feature) => {
      if (!features) {
        return getStoredFeatures().includes(feature);
      }

      return features.includes(feature);
    },
    [features]
  );

  return {
    features,
    isFeatureEnabled,
    Feature,
  };
}
