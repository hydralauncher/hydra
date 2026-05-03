import { Downloader } from "@shared";
import type { UserPreferences } from "@types";

const DOWNLOADER_PREFERENCE_KEYS: Partial<
  Record<Downloader, keyof UserPreferences>
> = {
  [Downloader.RealDebrid]: "realDebridApiToken",
  [Downloader.Premiumize]: "premiumizeApiToken",
  [Downloader.AllDebrid]: "allDebridApiToken",
  [Downloader.TorBox]: "torBoxApiToken",
};

function isConfiguredDownloader(
  downloader: Downloader,
  preferences?: UserPreferences | null
) {
  const preferenceKey = DOWNLOADER_PREFERENCE_KEYS[downloader];

  if (!preferenceKey) {
    return false;
  }

  return Boolean(preferences?.[preferenceKey]);
}

function getDownloaderSortRank(
  downloader: Downloader,
  preferences?: UserPreferences | null
) {
  if (isConfiguredDownloader(downloader, preferences)) {
    return 0;
  }

  if (downloader === Downloader.Torrent) {
    return 2;
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
