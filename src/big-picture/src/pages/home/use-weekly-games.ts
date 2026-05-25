import type { DownloadSource, ShopAssets } from "@types";
import { CatalogueCategory } from "@shared";
import { useEffect, useState } from "react";
import { normalizeShopAssetsList } from "./home-data";

async function getWeeklyGames(downloadSourceIds: string[]) {
  const response = await globalThis.window.electron.hydraApi.get<unknown>(
    `/catalogue/${CatalogueCategory.Weekly}`,
    {
      params: {
        take: 24,
        skip: 0,
        downloadSourceIds,
      },
      needsAuth: false,
    }
  );

  return normalizeShopAssetsList(response);
}

export function useWeeklyGames() {
  const [games, setGames] = useState<ShopAssets[]>([]);

  useEffect(() => {
    let isMounted = true;

    async function loadWeeklyGames() {
      const sources = (await globalThis.window.electron.leveldb.values(
        "downloadSources"
      )) as DownloadSource[];

      const sortedSources = [...sources].sort(
        (first, second) =>
          new Date(second.createdAt).getTime() -
          new Date(first.createdAt).getTime()
      );

      const downloadSourceIds = sortedSources.map((source) => source.id);
      const weeklyGames = await getWeeklyGames(downloadSourceIds);

      if (isMounted) {
        setGames(weeklyGames);
      }
    }

    void loadWeeklyGames().catch(() => {
      if (isMounted) {
        setGames([]);
      }
    });

    return () => {
      isMounted = false;
    };
  }, []);

  return games;
}
