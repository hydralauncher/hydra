import { useFeature } from "./use-feature";

export function useGlobalLeaderboardsFeature() {
  const { isFeatureEnabled, isFeaturesLoaded, Feature } = useFeature();

  return {
    isEnabled: isFeatureEnabled(Feature.GlobalLeaderboards),
    isLoaded: isFeaturesLoaded,
  };
}
