import { useMemo } from "react";
import type { GameRepack, UserPreferences } from "@types";
import { Downloader, getDownloadersForUri } from "@shared";

import { useAppSelector, useFeature, useUserDetails } from "@renderer/hooks";
import { Feature } from "@renderer/hooks/use-feature";

interface DownloadOptionsContext {
  userPreferences:
    | Pick<
        UserPreferences,
        | "realDebridApiToken"
        | "premiumizeApiToken"
        | "allDebridApiToken"
        | "torBoxApiToken"
      >
    | null
    | undefined;
  hasActiveSubscription: boolean;
  isFeatureEnabled: (feature: Feature) => boolean;
}

export const getDownloadOptions = (
  repack: GameRepack | null,
  {
    userPreferences,
    hasActiveSubscription,
    isFeatureEnabled,
  }: DownloadOptionsContext
) => {
  const unavailableUrisSet = new Set(repack?.unavailableUris ?? []);

  const downloaderMap = new Map<
    Downloader,
    { hasAvailable: boolean; hasUnavailable: boolean }
  >();

  if (repack) {
    for (const uri of repack.uris) {
      const uriDownloaders = getDownloadersForUri(uri);
      const isAvailable = !unavailableUrisSet.has(uri);

      for (const downloader of uriDownloaders) {
        const existing = downloaderMap.get(downloader);
        if (existing) {
          existing.hasAvailable = existing.hasAvailable || isAvailable;
          existing.hasUnavailable = existing.hasUnavailable || !isAvailable;
        } else {
          downloaderMap.set(downloader, {
            hasAvailable: isAvailable,
            hasUnavailable: !isAvailable,
          });
        }
      }
    }
  }

  const allDownloaders = Object.values(Downloader).filter(
    (value) => typeof value === "number" && value !== Downloader.Epic
  ) as Downloader[];

  const getDownloaderPriority = (option: {
    isAvailable: boolean;
    isAvailableButNotConfigured: boolean;
  }) => {
    if (option.isAvailable) return 0;
    if (option.isAvailableButNotConfigured) return 2;
    return 1;
  };

  return allDownloaders
    .filter((downloader) => {
      if (downloader === Downloader.Hydra) return false; // Temporarily comment out Nimbus
      if (!downloaderMap.has(downloader)) return false;
      if (
        downloader === Downloader.Premiumize &&
        !isFeatureEnabled(Feature.Premiumize)
      ) {
        return false;
      }

      if (
        downloader === Downloader.AllDebrid &&
        !isFeatureEnabled(Feature.AllDebrid)
      ) {
        return false;
      }

      return true;
    })
    .map((downloader) => {
      const status = downloaderMap.get(downloader);
      const hasAvailableUri = status?.hasAvailable ?? false;

      let isConfigured = true;
      if (downloader === Downloader.RealDebrid) {
        isConfigured = !!userPreferences?.realDebridApiToken;
      } else if (downloader === Downloader.Premiumize) {
        isConfigured = !!userPreferences?.premiumizeApiToken;
      } else if (downloader === Downloader.AllDebrid) {
        isConfigured = !!userPreferences?.allDebridApiToken;
      } else if (downloader === Downloader.TorBox) {
        isConfigured = !!userPreferences?.torBoxApiToken;
      } else if (downloader === Downloader.VikingFile) {
        isConfigured = hasActiveSubscription;
      }
      // } else if (downloader === Downloader.Hydra) {
      //   isConfigured = isFeatureEnabled(Feature.Nimbus);
      // }

      const isAvailableButNotConfigured = hasAvailableUri && !isConfigured;

      const isAvailable = hasAvailableUri && isConfigured;

      return {
        downloader,
        isAvailable,
        isAvailableButNotConfigured,
      };
    })
    .sort((a, b) => getDownloaderPriority(a) - getDownloaderPriority(b));
};

export function useDownloadOptions(repack: GameRepack | null) {
  const userPreferences = useAppSelector(
    (state) => state.userPreferences.value
  );
  const { isFeatureEnabled } = useFeature();
  const { hasActiveSubscription } = useUserDetails();

  const realDebridApiToken = userPreferences?.realDebridApiToken;
  const premiumizeApiToken = userPreferences?.premiumizeApiToken;
  const allDebridApiToken = userPreferences?.allDebridApiToken;
  const torBoxApiToken = userPreferences?.torBoxApiToken;

  return useMemo(
    () =>
      getDownloadOptions(repack, {
        userPreferences: {
          realDebridApiToken,
          premiumizeApiToken,
          allDebridApiToken,
          torBoxApiToken,
        },
        hasActiveSubscription,
        isFeatureEnabled,
      }),
    [
      repack,
      realDebridApiToken,
      premiumizeApiToken,
      allDebridApiToken,
      torBoxApiToken,
      hasActiveSubscription,
      isFeatureEnabled,
    ]
  );
}

export const getDefaultDownloader = (
  availableDownloaders: Downloader[]
): Downloader | null => {
  if (availableDownloaders.length === 0) return null;

  if (availableDownloaders.includes(Downloader.RealDebrid)) {
    return Downloader.RealDebrid;
  }

  if (availableDownloaders.includes(Downloader.Premiumize)) {
    return Downloader.Premiumize;
  }

  if (availableDownloaders.includes(Downloader.AllDebrid)) {
    return Downloader.AllDebrid;
  }

  if (availableDownloaders.includes(Downloader.TorBox)) {
    return Downloader.TorBox;
  }

  return availableDownloaders[0];
};
