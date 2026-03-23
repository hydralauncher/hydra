import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useDominantColor } from "@renderer/hooks/useDominantColor";
import { useTranslation } from "react-i18next";
import { levelDBService } from "@renderer/services/leveldb.service";
import { orderBy } from "lodash-es";
import { useNavigate } from "react-router-dom";

import Skeleton, { SkeletonTheme } from "react-loading-skeleton";

import { Button } from "@renderer/components";
import type { DownloadSource, LibraryGame, ShopAssets } from "@types";
import { useLibrary } from "@renderer/hooks/use-library";

import { buildGameDetailsPath } from "@renderer/helpers";
import { CatalogueCategory } from "@shared";
import cn from "classnames";
import { GameInfo } from "./game-info";
import "./home.scss";

export default function Home() {
  const { t } = useTranslation("home");
  const navigate = useNavigate();
  const { library } = useLibrary();

  const [isLoading, setIsLoading] = useState(false);
  const [isTransitioning, setIsTransitioning] = useState(false);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [isMyGames, setIsMyGames] = useState(true);
  const sliderRef = useRef<HTMLDivElement>(null);

  const [currentCatalogueCategory, setCurrentCatalogueCategory] = useState(
    CatalogueCategory.Hot
  );

  const [catalogue, setCatalogue] = useState<
    Record<CatalogueCategory, ShopAssets[]>
  >({
    [CatalogueCategory.Hot]: [],
    [CatalogueCategory.Weekly]: [],
    [CatalogueCategory.Achievements]: [],
  });

  const getCatalogue = useCallback(async (category: CatalogueCategory) => {
    try {
      setCurrentCatalogueCategory(category);
      setIsLoading(true);

      const sources = (await levelDBService.values(
        "downloadSources"
      )) as DownloadSource[];
      const downloadSources = orderBy(sources, "createdAt", "desc");

      const params = {
        take: 20,
        skip: 0,
        downloadSourceIds: downloadSources.map((source) => source.id),
      };

      const result = await window.electron.hydraApi.get<ShopAssets[]>(
        `/catalogue/${category}`,
        { params, needsAuth: false }
      );

      setCatalogue((prev) => ({ ...prev, [category]: result }));
      setSelectedIndex(0);
    } finally {
      setIsLoading(false);
    }
  }, []);

  const handleCategoryClick = (category: CatalogueCategory) => {
    if (category !== currentCatalogueCategory) {
      getCatalogue(category);
    }
  };

  const handleMyGamesClick = () => {
    setIsTransitioning(true);
    setIsMyGames(true);
    setSelectedIndex(0);
    requestAnimationFrame(() => setIsTransitioning(false));
  };

  const handleCatTabClick = (category: CatalogueCategory) => {
    setIsMyGames(false);
    handleCategoryClick(category);
  };

  useEffect(() => {
    setIsLoading(true);
    getCatalogue(CatalogueCategory.Hot);
  }, [getCatalogue]);

  const categories = Object.values(CatalogueCategory);

  const libraryAsGames = useMemo<ShopAssets[]>(
    () =>
      library
        .filter(
          (
            g
          ): g is LibraryGame & {
            objectId: string;
            shop: NonNullable<LibraryGame["shop"]>;
          } => Boolean(g.objectId && g.shop)
        )
        .map((g) => ({
          objectId: g.objectId!,
          shop: g.shop!,
          title: g.title,
          iconUrl: g.iconUrl ?? null,
          libraryHeroImageUrl: g.libraryHeroImageUrl ?? null,
          libraryImageUrl: g.libraryImageUrl ?? null,
          logoImageUrl: g.logoImageUrl ?? null,
          logoPosition: null,
          coverImageUrl: null,
          downloadSources: [],
        })),
    [library]
  );

  const showSkeleton = isLoading || isTransitioning;
  const currentGames = isMyGames
    ? libraryAsGames
    : catalogue[currentCatalogueCategory];
  const selectedGame = showSkeleton
    ? null
    : (currentGames[selectedIndex] ?? null);

  const backgroundSrc = useMemo(() => {
    if (!selectedGame) return undefined;
    if (selectedGame.libraryHeroImageUrl) {
      return selectedGame.libraryHeroImageUrl;
    }
    if (selectedGame.shop === "steam") {
      return `https://steamcdn-a.akamaihd.net/steam/apps/${selectedGame.objectId}/library_hero.jpg`;
    }
    return selectedGame.libraryImageUrl ?? undefined;
  }, [selectedGame]);

  const cardImageUrl = useMemo(() => {
    if (!selectedGame) return undefined;
    return selectedGame.shop === "steam"
      ? `https://steamcdn-a.akamaihd.net/steam/apps/${selectedGame.objectId}/library_600x900_2x.jpg`
      : (selectedGame.libraryImageUrl ?? undefined);
  }, [selectedGame]);

  const glowColor = useDominantColor(cardImageUrl);

  const scrollToCard = useCallback((index: number) => {
    const slider = sliderRef.current;
    if (!slider) return;
    const card = slider.children[index] as HTMLElement | undefined;
    if (!card) return;
    const offset = slider.clientWidth * 0.03;
    slider.scrollTo({ left: card.offsetLeft - offset, behavior: "smooth" });
  }, []);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (isLoading || currentGames.length === 0) return;

      if (e.key === "ArrowRight") {
        e.preventDefault();
        setSelectedIndex((prev) => {
          const next = Math.min(prev + 1, currentGames.length - 1);
          scrollToCard(next);
          return next;
        });
      } else if (e.key === "ArrowLeft") {
        e.preventDefault();
        setSelectedIndex((prev) => {
          const next = Math.max(prev - 1, 0);
          scrollToCard(next);
          return next;
        });
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [isLoading, currentGames.length, scrollToCard]);

  useEffect(() => {
    if (!isLoading && currentGames.length > 0) {
      requestAnimationFrame(() => scrollToCard(0));
    }
  }, [isLoading, currentGames.length, scrollToCard]);

  return (
    <SkeletonTheme baseColor="#1c1c1c" highlightColor="#444">
      <section className="home">
        {backgroundSrc && (
          <img
            src={backgroundSrc}
            alt=""
            className="home__background"
            key={backgroundSrc}
          />
        )}
        <div className="home__overlay" />

        <div className="home__content">
          <ul className="home__tabs">
            <li>
              <Button
                theme={isMyGames ? "primary" : "outline"}
                onClick={handleMyGamesClick}
              >
                {t("my_games")}
              </Button>
            </li>
            {categories.map((category) => (
              <li key={category}>
                <Button
                  theme={
                    !isMyGames && category === currentCatalogueCategory
                      ? "primary"
                      : "outline"
                  }
                  onClick={() => handleCatTabClick(category)}
                >
                  {t(category)}
                </Button>
              </li>
            ))}
          </ul>

          <div className="home__slider" ref={sliderRef}>
            {showSkeleton
              ? Array.from({ length: 8 }).map((_, i) => (
                  <div key={i} className="home__card">
                    <Skeleton className="home__card-skeleton" />
                  </div>
                ))
              : currentGames.map((game, index) => (
                  <button
                    key={game.objectId}
                    type="button"
                    className={cn("home__card", {
                      "home__card--selected": index === selectedIndex,
                    })}
                    onClick={() => setSelectedIndex(index)}
                    onDoubleClick={() => navigate(buildGameDetailsPath(game))}
                    style={
                      index === selectedIndex
                        ? { boxShadow: `inset 0 0 0 2px ${glowColor}` }
                        : undefined
                    }
                  >
                    <img
                      src={
                        game.shop === "steam"
                          ? `https://steamcdn-a.akamaihd.net/steam/apps/${game.objectId}/library_600x900_2x.jpg`
                          : (game.libraryImageUrl ?? undefined)
                      }
                      alt={game.title}
                      className="home__card-image"
                      loading="lazy"
                      onError={(e) => {
                        const img = e.currentTarget;
                        if (
                          game.libraryImageUrl &&
                          img.src !== game.libraryImageUrl
                        ) {
                          img.src = game.libraryImageUrl;
                        }
                      }}
                    />
                  </button>
                ))}
          </div>

          {selectedGame && (
            <GameInfo game={selectedGame} showAddButton={!isMyGames} />
          )}
        </div>
      </section>
    </SkeletonTheme>
  );
}
