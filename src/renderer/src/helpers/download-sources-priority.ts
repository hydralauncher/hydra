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

export function getPriorityRepack(
  repacks: GameRepack[],
  sources: DownloadSource[],
  priorityIds?: string[]
): GameRepack | null {
  if (!repacks.length) return null;

  const sortedSources = getSortedSourcesByPriority(sources, priorityIds);

  for (const source of sortedSources) {
    const repacksForSource = repacks.filter(
      (r) =>
        r.downloadSourceId === source.id ||
        (source.name &&
          r.downloadSourceName?.toLowerCase() === source.name.toLowerCase())
    );

    if (repacksForSource.length > 0) {
      const sorted = orderBy(
        repacksForSource,
        [(r) => new Date(r.uploadDate || r.createdAt || 0).getTime()],
        ["desc"]
      );
      return sorted[0];
    }
  }

  return (
    orderBy(
      repacks,
      [(r) => new Date(r.uploadDate || r.createdAt || 0).getTime()],
      ["desc"]
    )[0] || null
  );
}

export function getBestDownloaderForRepack(
  repack: GameRepack,
  userPreferences?: UserPreferences
): { downloader: Downloader; uri: string } | null {
  for (const uri of repack.uris) {
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
    if (downloaders.includes(Downloader.VikingFile)) {
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
        d !== Downloader.AllDebrid
    );
    if (nonDebridDownloaders.length > 0) {
      return { downloader: nonDebridDownloaders[0], uri };
    }
  }

  return null;
}
