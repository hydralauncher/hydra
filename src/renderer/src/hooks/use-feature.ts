import { useEffect } from "react";

enum Feature {
  CheckDownloadWritePermission = "CHECK_DOWNLOAD_WRITE_PERMISSION",
  Torbox = "TORBOX",
}

export function useFeature() {
  useEffect(() => {
    window.electron.getFeatures().then((features) => {
      localStorage.setItem("features", JSON.stringify(features || []));
    });
  }, []);

  const isFeatureEnabled = (feature: Feature) => {
    const features = JSON.parse(localStorage.getItem("features") ?? "[]");
    return features.includes(feature);
  };

  return {
    isFeatureEnabled,
    Feature,
  };
}
