import type { DownloadSource } from "@types";
import { CatalogueCategory } from "@shared";
import { useEffect, useState } from "react";
import {
  normalizeHomeChallengeGameList,
  type HomeChallengeGame,
} from "./home-data";

async function getHardPlatinums(downloadSourceIds: string[]) {
  const response = await globalThis.window.electron.hydraApi.get<unknown>(
    `/catalogue/${CatalogueCategory.Achievements}`,
    {
      params: {
        take: 12,
        skip: 0,
        downloadSourceIds,
      },
      needsAuth: false,
    }
  );

  return normalizeHomeChallengeGameList(response);
}

export function useHardPlatinums() {
  const [games, setGames] = useState<HomeChallengeGame[]>([]);

  useEffect(() => {
    let isMounted = true;

    async function loadHardPlatinums() {
      const sources = (await globalThis.window.electron.leveldb.values(
        "downloadSources"
      )) as DownloadSource[];

      const sortedSources = [...sources].sort(
        (first, second) =>
          new Date(second.createdAt).getTime() -
          new Date(first.createdAt).getTime()
      );

      const downloadSourceIds = sortedSources.map((source) => source.id);
      const hardPlatinums = await getHardPlatinums(downloadSourceIds);

      if (isMounted) {
        setGames(hardPlatinums);
      }
    }

    void loadHardPlatinums().catch(() => {
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
