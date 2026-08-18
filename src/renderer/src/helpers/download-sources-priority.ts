import { Downloader, getDownloadersForUri } from "@shared";
import type { DownloadSource, GameRepack, UserPreferences } from "@types";
import { orderBy } from "lodash-es";

export function getSortedSourcesByPriority(
  sources: DownloadSource[],
  priorityIds?: string[]
): DownloadSource[] {
  if (!priorityIds || priorityIds.length === 0) {
    return sources;
  }

  const priorityMap = new Map<string, number>();
  priorityIds.forEach((id, index) => {
    priorityMap.set(id, index);
  });

  return [...sources].sort((a, b) => {
    const aPriority = priorityMap.has(a.id)
      ? (priorityMap.get(a.id) as number)
      : Number.MAX_SAFE_INTEGER;
    const bPriority = priorityMap.has(b.id)
      ? (priorityMap.get(b.id) as number)
      : Number.MAX_SAFE_INTEGER;

    if (aPriority !== bPriority) {
      return aPriority - bPriority;
    }

    return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
  });
}

export interface RepackDownloadCandidate {
  repack: GameRepack;
  downloader: Downloader;
  uri: string;
}

/**
 * Returns every usable repack+downloader combination in priority order
 * (source priority first, then upload date within a source). Used to fall
 * back to the next candidate when the highest-priority one fails to start.
 */
export function getOrderedRepackCandidates(
  repacks: GameRepack[],
  sources: DownloadSource[],
  priorityIds?: string[],
  userPreferences?: UserPreferences,
  hasActiveSubscription = false
): RepackDownloadCandidate[] {
  if (!repacks.length) return [];

  const sortedSources = getSortedSourcesByPriority(sources, priorityIds);
  const candidates: RepackDownloadCandidate[] = [];
  const consumedRepackIds = new Set<string>();

  const collectUsable = (repacksToCheck: GameRepack[]) => {
    const sorted = orderBy(
      repacksToCheck,
      [(r) => new Date(r.uploadDate || r.createdAt || 0).getTime()],
      ["desc"]
    );

    for (const repack of sorted) {
      if (consumedRepackIds.has(repack.id)) continue;

      const best = getBestDownloaderForRepack(
        repack,
        userPreferences,
        hasActiveSubscription
      );
      if (best) {
        consumedRepackIds.add(repack.id);
        candidates.push({ repack, ...best });
      }
    }
  };

  for (const source of sortedSources) {
    const repacksForSource = repacks.filter(
      (r) =>
        r.downloadSourceId === source.id ||
        (source.name &&
          r.downloadSourceName?.toLowerCase() === source.name.toLowerCase())
    );
    collectUsable(repacksForSource);
  }

  collectUsable(repacks);

  return candidates;
}

export function getPriorityRepack(
  repacks: GameRepack[],
  sources: DownloadSource[],
  priorityIds?: string[],
  userPreferences?: UserPreferences,
  hasActiveSubscription = false
): GameRepack | null {
  if (!repacks.length) return null;

  const [firstCandidate] = getOrderedRepackCandidates(
    repacks,
    sources,
    priorityIds,
    userPreferences,
    hasActiveSubscription
  );
  if (firstCandidate) return firstCandidate.repack;

  const sortedAll = orderBy(
    repacks,
    [(r) => new Date(r.uploadDate || r.createdAt || 0).getTime()],
    ["desc"]
  );

  return sortedAll[0] || null;
}

export function getBestDownloaderForRepack(
  repack: GameRepack,
  userPreferences?: UserPreferences,
  hasActiveSubscription = false
): { downloader: Downloader; uri: string } | null {
  const unavailableSet = new Set(repack.unavailableUris ?? []);
  const availableUris = (repack.uris || []).filter(
    (uri) => !unavailableSet.has(uri)
  );
  const candidateUris =
    availableUris.length > 0 ? availableUris : repack.uris || [];

  for (const uri of candidateUris) {
    const downloaders = getDownloadersForUri(uri);

    if (
      userPreferences?.realDebridApiToken &&
      downloaders.includes(Downloader.RealDebrid)
    ) {
      return { downloader: Downloader.RealDebrid, uri };
    }

    if (
      userPreferences?.torBoxApiToken &&
      downloaders.includes(Downloader.TorBox)
    ) {
      return { downloader: Downloader.TorBox, uri };
    }

    if (
      userPreferences?.premiumizeApiToken &&
      downloaders.includes(Downloader.Premiumize)
    ) {
      return { downloader: Downloader.Premiumize, uri };
    }

    if (
      userPreferences?.allDebridApiToken &&
      downloaders.includes(Downloader.AllDebrid)
    ) {
      return { downloader: Downloader.AllDebrid, uri };
    }

    if (downloaders.includes(Downloader.Gofile)) {
      return { downloader: Downloader.Gofile, uri };
    }
    if (downloaders.includes(Downloader.PixelDrain)) {
      return { downloader: Downloader.PixelDrain, uri };
    }
    if (downloaders.includes(Downloader.Mediafire)) {
      return { downloader: Downloader.Mediafire, uri };
    }
    if (downloaders.includes(Downloader.Datanodes)) {
      return { downloader: Downloader.Datanodes, uri };
    }
    if (downloaders.includes(Downloader.FuckingFast)) {
      return { downloader: Downloader.FuckingFast, uri };
    }
    if (hasActiveSubscription && downloaders.includes(Downloader.VikingFile)) {
      return { downloader: Downloader.VikingFile, uri };
    }
    if (downloaders.includes(Downloader.Rootz)) {
      return { downloader: Downloader.Rootz, uri };
    }
    if (downloaders.includes(Downloader.ArchiveOrg)) {
      return { downloader: Downloader.ArchiveOrg, uri };
    }
    if (downloaders.includes(Downloader.Torrent)) {
      return { downloader: Downloader.Torrent, uri };
    }

    const nonDebridDownloaders = downloaders.filter(
      (d) =>
        d !== Downloader.RealDebrid &&
        d !== Downloader.TorBox &&
        d !== Downloader.Premiumize &&
        d !== Downloader.AllDebrid &&
        (hasActiveSubscription || d !== Downloader.VikingFile)
    );
    if (nonDebridDownloaders.length > 0) {
      return { downloader: nonDebridDownloaders[0], uri };
    }
  }

  return null;
}
