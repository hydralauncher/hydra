import { useEffect, useState, useCallback } from "react";

enum Feature {
  CheckDownloadWritePermission = "CHECK_DOWNLOAD_WRITE_PERMISSION",
  Torbox = "TORBOX",
  Nimbus = "NIMBUS",
}

export function useFeature() {
  const [features, setFeatures] = useState<string[] | null>(null);

  useEffect(() => {
    window.electron.getFeatures().then((features) => {
      localStorage.setItem("features", JSON.stringify(features || []));
      setFeatures(features || []);
    });
  }, []);

  const isFeatureEnabled = useCallback(
    (feature: Feature) => {
      if (!features) {
        const features = JSON.parse(localStorage.getItem("features") ?? "[]");
        return features.includes(feature);
      }

      return features.includes(feature);
    },
    [features]
  );

  return {
    isFeatureEnabled,
    Feature,
  };
}
