import { useEffect, useMemo, useState } from "react";
import type { DownloadSource, GameRepack, LibraryGame } from "@types";
import { DOWNLOADER_NAME } from "@renderer/constants";
import { levelDBService } from "@renderer/services/leveldb.service";
import { isUriMatch } from "@renderer/helpers";

export interface ActiveDownloadInfo {
  sourceName: string;
}

const repacksCache = new Map<string, GameRepack[]>();
let sourcesCache: DownloadSource[] | null = null;

async function getCachedDownloadSources(): Promise<DownloadSource[]> {
  if (!sourcesCache) {
    const all = (await levelDBService.values(
      "downloadSources"
    )) as DownloadSource[];
    sourcesCache = all ?? [];
  }
  return sourcesCache;
}

async function fetchGameRepacks(
  shop: string,
  objectId: string,
  sourceIds: string[]
): Promise<GameRepack[]> {
  const result = await window.electron.hydraApi
    .get<GameRepack[]>(`/games/${shop}/${objectId}/download-sources`, {
      params: { take: 100, skip: 0, downloadSourceIds: sourceIds },
      needsAuth: false,
    })
    .catch(() => [] as GameRepack[]);

  return Array.isArray(result) ? result : [];
}

export function useActiveDownloadInfo(
  activeGame: LibraryGame | null
): ActiveDownloadInfo {
  const [matchingRepack, setMatchingRepack] = useState<GameRepack | null>(null);

  const fallbackSource = useMemo(() => {
    if (!activeGame?.download) return "—";
    const downloaderNum = Number(activeGame.download.downloader);
    return DOWNLOADER_NAME[downloaderNum] || "Torrent";
  }, [activeGame?.download]);

  useEffect(() => {
    let cancelled = false;

    if (!activeGame?.download || activeGame.shop === "custom") {
      setMatchingRepack(null);
      return;
    }

    const { shop, objectId } = activeGame;
    const cacheKey = `${shop}:${objectId}`;

    const resolve = async () => {
      let repacks = repacksCache.get(cacheKey);

      if (!repacks) {
        const sources = await getCachedDownloadSources();
        const sourceIds = sources.map((s) => s.id);
        repacks = await fetchGameRepacks(shop, objectId, sourceIds);
        if (repacks.length > 0) repacksCache.set(cacheKey, repacks);
      }

      if (cancelled) return;

      const currentUri = activeGame.download?.uri;
      const match = repacks.find(
        (r) =>
          Array.isArray(r.uris) && r.uris.some((u) => isUriMatch(u, currentUri))
      );

      setMatchingRepack(match ?? null);
    };

    resolve().catch(() => {
      if (!cancelled) setMatchingRepack(null);
    });

    return () => {
      cancelled = true;
    };
  }, [activeGame]);

  const sourceName = useMemo(() => {
    if (!activeGame) return "—";
    return matchingRepack?.downloadSourceName || fallbackSource;
  }, [activeGame, matchingRepack, fallbackSource]);

  return { sourceName };
}
