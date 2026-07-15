import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { levelDBService } from "@renderer/services/leveldb.service";
import { orderBy } from "lodash-es";
import { useNavigate } from "react-router-dom";

import { SkeletonTheme } from "react-loading-skeleton";

import { Button, Hero } from "@renderer/components";
import type {
  CatalogueSearchResult,
  DownloadSource,
  ShopAssets,
  Steam250Game,
} from "@types";

import { Shuffle } from "lucide-react";

import { buildGameDetailsPath, ensureArray } from "@renderer/helpers";
import { CatalogueCategory } from "@shared";
import { CategoryRow } from "./category-row";
import "./home.scss";

const CATEGORIES = Object.values(CatalogueCategory);

export default function Home() {
  const { t } = useTranslation("home");
  const navigate = useNavigate();

  const [randomGame, setRandomGame] = useState<Steam250Game | null>(null);

  const [catalogue, setCatalogue] = useState<
    Record<CatalogueCategory, ShopAssets[]>
  >({
    [CatalogueCategory.Hot]: [],
    [CatalogueCategory.Weekly]: [],
    [CatalogueCategory.Achievements]: [],
  });

  const [loadingStates, setLoadingStates] = useState<
    Record<CatalogueCategory, boolean>
  >({
    [CatalogueCategory.Hot]: true,
    [CatalogueCategory.Weekly]: true,
    [CatalogueCategory.Achievements]: true,
  });

  const [classics, setClassics] = useState<ShopAssets[]>([]);
  const [isClassicsLoading, setIsClassicsLoading] = useState(false);

  const getCatalogue = useCallback(async (category: CatalogueCategory) => {
    setLoadingStates((prev) => ({ ...prev, [category]: true }));
    try {
      const sources = (await levelDBService.values(
        "downloadSources"
      )) as DownloadSource[];
      const downloadSources = orderBy(sources, "createdAt", "desc");

      const params = {
        take: 12,
        skip: 0,
        downloadSourceIds: downloadSources.map((source) => source.id),
      };

      const result = await window.electron.hydraApi.get<ShopAssets[]>(
        `/catalogue/${category}`,
        {
          params,
          needsAuth: false,
        }
      );

      setCatalogue((prev) => ({
        ...prev,
        [category]: ensureArray<ShopAssets>(result, `/catalogue/${category}`),
      }));
    } finally {
      setLoadingStates((prev) => ({ ...prev, [category]: false }));
    }
  }, []);

  const getRandomGame = useCallback(() => {
    window.electron.getRandomGame().then((game) => {
      if (game) setRandomGame(game);
    });
  }, []);

  const handleRandomizerClick = () => {
    if (randomGame) {
      navigate(
        buildGameDetailsPath(
          { ...randomGame, shop: "steam" },
          {
            fromRandomizer: "1",
          }
        )
      );
    }
  };

  const getClassics = useCallback(async () => {
    setIsClassicsLoading(true);
    try {
      const sources = (await levelDBService.values(
        "downloadSources"
      )) as DownloadSource[];
      const downloadSourceIds = sources.map((source) => source.id);

      const result = await window.electron.hydraApi.post<{
        edges: CatalogueSearchResult[];
        count: number;
      }>("/catalogue/search", {
        data: {
          title: "",
          sortBy: "popularity",
          sortOrder: "desc",
          take: 12,
          skip: 0,
          tags: [],
          publishers: [],
          genres: [],
          developers: [],
          protondbSupportBadges: [],
          deckCompatibility: [],
          downloadSourceIds,
          shops: ["launchbox"],
          platforms: [],
        },
        needsAuth: false,
      });

      const games: ShopAssets[] = result.edges.map((game) => ({
        objectId: game.objectId,
        shop: game.shop,
        title: game.title,
        iconUrl: null,
        libraryHeroImageUrl: null,
        libraryImageUrl: game.libraryImageUrl,
        logoImageUrl: null,
        logoPosition: null,
        coverImageUrl: null,
        downloadSources: game.downloadSources,
      }));

      setClassics(games);
    } catch {
      setClassics([]);
    } finally {
      setIsClassicsLoading(false);
    }
  }, []);

  const handleGameClick = useCallback(
    (game: ShopAssets) => {
      navigate(buildGameDetailsPath(game));
    },
    [navigate]
  );

  useEffect(() => {
    getCatalogue(CatalogueCategory.Hot);
    getCatalogue(CatalogueCategory.Weekly);
    getCatalogue(CatalogueCategory.Achievements);
    getClassics();

    getRandomGame();
  }, [getCatalogue, getRandomGame, getClassics]);

  return (
    <SkeletonTheme baseColor="#1c1c1c" highlightColor="#444">
      <section className="home__content">
        <Hero
          games={catalogue[CatalogueCategory.Hot]}
          isLoading={loadingStates[CatalogueCategory.Hot]}
        />

        <div className="home__header">
          <Button
            onClick={handleRandomizerClick}
            theme="outline"
            disabled={!randomGame}
          >
            <Shuffle size={16} />
            {t("surprise_me")}
          </Button>
        </div>

        {CATEGORIES.map((category) => (
          <CategoryRow
            key={category}
            title={t(category)}
            games={catalogue[category]}
            isLoading={loadingStates[category]}
            onGameClick={handleGameClick}
          />
        ))}

        <CategoryRow
          title={t("classics")}
          games={classics}
          isLoading={isClassicsLoading}
          onGameClick={handleGameClick}
        />
      </section>
    </SkeletonTheme>
  );
}
