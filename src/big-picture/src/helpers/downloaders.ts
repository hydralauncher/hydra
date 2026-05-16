import { Downloader, getDownloadersForUri } from "@shared";
import type { GameRepack, UserPreferences } from "@types";

const DOWNLOADER_PREFERENCE_KEYS: Partial<
  Record<Downloader, keyof UserPreferences>
> = {
  [Downloader.RealDebrid]: "realDebridApiToken",
  [Downloader.Premiumize]: "premiumizeApiToken",
  [Downloader.AllDebrid]: "allDebridApiToken",
  [Downloader.TorBox]: "torBoxApiToken",
};

const DOWNLOADER_FEATURE_FLAGS: Partial<Record<Downloader, string>> = {
  [Downloader.Premiumize]: "PREMIUMIZE",
  [Downloader.AllDebrid]: "ALLDEBRID",
};

export interface DownloaderAvailabilityOption {
  downloader: Downloader;
  canHandle: boolean;
  hasAvailableUri: boolean;
  isConfigured: boolean;
  isAvailable: boolean;
  availableUri: string | null;
}

function isConfiguredDownloader(
  downloader: Downloader,
  preferences?: UserPreferences | null
) {
  const preferenceKey = DOWNLOADER_PREFERENCE_KEYS[downloader];

  if (!preferenceKey) {
    return true;
  }

  return Boolean(preferences?.[preferenceKey]);
}

function isFeatureEnabledForDownloader(
  downloader: Downloader,
  enabledFeatures?: string[] | null
) {
  const requiredFeature = DOWNLOADER_FEATURE_FLAGS[downloader];

  if (!requiredFeature) {
    return true;
  }

  return enabledFeatures?.includes(requiredFeature) ?? false;
}

function getDownloaderSortRank(
  downloader: Downloader,
  preferences?: UserPreferences | null
) {
  if (downloader === Downloader.Torrent) {
    return 2;
  }

  if (isConfiguredDownloader(downloader, preferences)) {
    return 0;
  }

  return 1;
}

export function sortAvailableDownloaders(
  downloaders: Downloader[],
  preferences?: UserPreferences | null
) {
  const originalOrder = new Map(
    downloaders.map((downloader, index) => [downloader, index])
  );

  return [...downloaders].sort((left, right) => {
    const rankDifference =
      getDownloaderSortRank(left, preferences) -
      getDownloaderSortRank(right, preferences);

    if (rankDifference !== 0) {
      return rankDifference;
    }

    return (originalOrder.get(left) ?? 0) - (originalOrder.get(right) ?? 0);
  });
}

export function getDownloaderAvailabilityOptions(
  repack: Pick<GameRepack, "uris" | "unavailableUris">,
  preferences?: UserPreferences | null,
  enabledFeatures?: string[] | null
) {
  const unavailableUrisSet = new Set(repack.unavailableUris ?? []);
  const downloaderMap = new Map<
    Downloader,
    {
      hasAvailable: boolean;
      hasUnavailable: boolean;
      availableUri: string | null;
    }
  >();
  const allDownloaders = Object.values(Downloader).filter(
    (value) => typeof value === "number"
  ) as Downloader[];

  for (const uri of repack.uris) {
    const uriDownloaders = getDownloadersForUri(uri);
    const isAvailable = !unavailableUrisSet.has(uri);

    for (const downloader of uriDownloaders) {
      const existing = downloaderMap.get(downloader);

      if (existing) {
        existing.hasAvailable = existing.hasAvailable || isAvailable;
        existing.hasUnavailable = existing.hasUnavailable || !isAvailable;

        if (isAvailable && !existing.availableUri) {
          existing.availableUri = uri;
        }
      } else {
        downloaderMap.set(downloader, {
          hasAvailable: isAvailable,
          hasUnavailable: !isAvailable,
          availableUri: isAvailable ? uri : null,
        });
      }
    }
  }

  const getDownloaderPriority = (option: DownloaderAvailabilityOption) => {
    if (option.isAvailable) return 0;
    if (option.canHandle) return 1;
    return 2;
  };

  return allDownloaders
    .filter((downloader) => {
      if (downloader === Downloader.Hydra) return false;

      return isFeatureEnabledForDownloader(downloader, enabledFeatures);
    })
    .map((downloader) => {
      const status = downloaderMap.get(downloader);
      const canHandle = status !== undefined;
      const hasAvailableUri = status?.hasAvailable ?? false;
      const isConfigured = isConfiguredDownloader(downloader, preferences);
      const isAvailable = canHandle && hasAvailableUri && isConfigured;

      return {
        downloader,
        canHandle,
        hasAvailableUri,
        isConfigured,
        isAvailable,
        availableUri: status?.availableUri ?? null,
      } satisfies DownloaderAvailabilityOption;
    })
    .sort(
      (left, right) =>
        getDownloaderPriority(left) - getDownloaderPriority(right)
    );
}
