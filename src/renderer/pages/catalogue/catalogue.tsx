import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { useNavigate } from "react-router-dom";

import Skeleton, { SkeletonTheme } from "react-loading-skeleton";

import { Button, GameCard, Hero } from "@renderer/components";
import type { CatalogueCategory, CatalogueEntry } from "@types";

import * as styles from "./catalogue.css";
import { vars } from "@renderer/theme.css";

const categories: CatalogueCategory[] = ["trending", "recently_added"];

export function Catalogue() {
  const { t } = useTranslation("catalogue");
  const navigate = useNavigate();

  const [isLoading, setIsLoading] = useState(false);
  const [isLoadingRandomGame, setIsLoadingRandomGame] = useState(false);

  const [currentCategory, setCurrentCategory] = useState(categories.at(0)!);
  const [catalogue, setCatalogue] = useState<
    Record<CatalogueCategory, CatalogueEntry[]>
  >({
    trending: [],
    recently_added: [],
  });

  const getCatalogue = useCallback((category: CatalogueCategory) => {
    setIsLoading(true);

    window.electron
      .getCatalogue(category)
      .then((catalogue) => {
        setCatalogue((prev) => ({ ...prev, [category]: catalogue }));
      })
      .catch(() => {})
      .finally(() => {
        setIsLoading(false);
      });
  }, []);

  const handleSelectCategory = (category: CatalogueCategory) => {
    if (category !== currentCategory) {
      getCatalogue(category);
      setCurrentCategory(category);
    }
  };

  const handleRandomizerClick = () => {
    setIsLoadingRandomGame(true);

    window.electron
      .getRandomGame()
      .then((objectID) => {
        navigate(`/game/steam/${objectID}`);
      })
      .finally(() => {
        setIsLoadingRandomGame(false);
      });
  };

  useEffect(() => {
    setIsLoading(true);
    getCatalogue(categories.at(0)!);
  }, [getCatalogue]);

  return (
    <SkeletonTheme baseColor={vars.color.background} highlightColor="#444">
      <section className={styles.content}>
        <h2>{t("featured")}</h2>

        <Hero />

        <section className={styles.catalogueHeader}>
          <div className={styles.catalogueCategories}>
            {categories.map((category) => (
              <Button
                key={category}
                theme={currentCategory === category ? "primary" : "outline"}
                onClick={() => handleSelectCategory(category)}
              >
                {t(category)}
              </Button>
            ))}
          </div>

          <Button
            onClick={handleRandomizerClick}
            theme="outline"
            disabled={isLoadingRandomGame}
          >
            {t("surprise_me")}
          </Button>
        </section>

        <h2>{t(currentCategory)}</h2>

        <section className={styles.cards({})}>
          {isLoading
            ? Array.from({ length: 12 }).map((_, index) => (
                <Skeleton key={index} className={styles.cardSkeleton} />
              ))
            : catalogue[currentCategory].map((result) => (
                <GameCard
                  key={result.objectID}
                  game={result}
                  onClick={() =>
                    navigate(`/game/${result.shop}/${result.objectID}`)
                  }
                />
              ))}
        </section>
      </section>
    </SkeletonTheme>
  );
}
