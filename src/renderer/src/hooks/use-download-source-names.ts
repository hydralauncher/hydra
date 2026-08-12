import { useEffect, useState } from "react";
import { orderBy } from "lodash-es";
import type { DownloadSource, GameRepack, ShopAssets } from "@types";
import { levelDBService } from "@renderer/services/leveldb.service";

let sourcesCache: DownloadSource[] | null = null;

const UUID_RE = /^[0-9a-f-]{36}$/i;

export function useDownloadSourceNames(
  game: Pick<ShopAssets, "objectId" | "shop" | "downloadSources">
) {
  const [sourceNames, setSourceNames] = useState<string[]>([]);

  useEffect(() => {
    let cancelled = false;

    const resolve = async () => {
      if (!sourcesCache) {
        const all = (await levelDBService.values(
          "downloadSources"
        )) as DownloadSource[];
        sourcesCache = orderBy(all, "createdAt", "desc");
      }

      const sources = game.downloadSources ?? [];

      if (sources.length) {
        const areIds = sources.every((s) => UUID_RE.test(s));
        if (!areIds) {
          if (!cancelled) setSourceNames(sources);
          return;
        }

        const names = sources
          .map((id) => sourcesCache!.find((s) => s.id === id)?.name)
          .filter(Boolean) as string[];
        if (!cancelled) setSourceNames(names);
        return;
      }

      // Home/library games don't carry pre-resolved download sources, so we
      // look them up the same way the game details page does.
      if (game.shop === "custom" || !sourcesCache.length) {
        if (!cancelled) setSourceNames([]);
        return;
      }

      const repacks = await window.electron.hydraApi
        .get<GameRepack[]>(
          `/games/${game.shop}/${game.objectId}/download-sources`,
          {
            params: {
              take: 100,
              skip: 0,
              downloadSourceIds: sourcesCache.map((source) => source.id),
            },
            needsAuth: false,
          }
        )
        .catch(() => []);

      if (cancelled) return;

      const names = Array.from(
        new Set(
          (Array.isArray(repacks) ? repacks : [])
            .map((repack) => repack.downloadSourceName)
            .filter(Boolean)
        )
      );
      setSourceNames(names);
    };

    resolve().catch(() => {
      if (!cancelled) setSourceNames([]);
    });

    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [game.objectId, game.shop, game.downloadSources?.join(",")]);

  return sourceNames;
}
