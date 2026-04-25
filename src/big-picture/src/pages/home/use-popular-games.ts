import type { DownloadSource, ShopAssets } from "@types";
import { CatalogueCategory } from "@shared";
import { useEffect, useState } from "react";

interface HomeGamesRows {
  popularGames: ShopAssets[];
  gamesOfTheWeek: ShopAssets[];
  gamesToBeat: ShopAssets[];
}

const EMPTY_HOME_GAMES_ROWS: HomeGamesRows = {
  popularGames: [],
  gamesOfTheWeek: [],
  gamesToBeat: [],
};

async function getCatalogueGames(
  category: CatalogueCategory,
  downloadSourceIds: string[]
) {
  return globalThis.window.electron.hydraApi.get<ShopAssets[]>(
    `/catalogue/${category}`,
    {
      params: {
        take: 12,
        skip: 0,
        downloadSourceIds,
      },
      needsAuth: false,
    }
  );
}

export function usePopularGames() {
  const [games, setGames] = useState<HomeGamesRows>(EMPTY_HOME_GAMES_ROWS);

  useEffect(() => {
    let isMounted = true;

    async function loadPopularGames() {
      const sources = (await globalThis.window.electron.leveldb.values(
        "downloadSources"
      )) as DownloadSource[];

      const downloadSources = [...sources].sort(
        (first, second) =>
          new Date(second.createdAt).getTime() -
          new Date(first.createdAt).getTime()
      );

      const downloadSourceIds = downloadSources.map((source) => source.id);
      const [popularGames, gamesOfTheWeek, gamesToBeat] = await Promise.all([
        getCatalogueGames(CatalogueCategory.Hot, downloadSourceIds),
        getCatalogueGames(CatalogueCategory.Weekly, downloadSourceIds),
        getCatalogueGames(CatalogueCategory.Achievements, downloadSourceIds),
      ]);

      if (isMounted) setGames({ popularGames, gamesOfTheWeek, gamesToBeat });
    }

    void loadPopularGames().catch(() => {
      if (isMounted) setGames(EMPTY_HOME_GAMES_ROWS);
    });

    return () => {
      isMounted = false;
    };
  }, []);

  return games;
}
