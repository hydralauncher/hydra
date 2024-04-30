import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { useNavigate, useSearchParams } from "react-router-dom";

import Skeleton, { SkeletonTheme } from "react-loading-skeleton";

import { Button, GameCard, Hero } from "@renderer/components";
import type { CatalogueCategory, CatalogueEntry } from "@types";

import starsAnimation from "@renderer/assets/lottie/stars.json";

import * as styles from "./home.css";
import { vars } from "../../theme.css";
import Lottie from "lottie-react";

const categories: CatalogueCategory[] = ["trending", "recently_added"];

export function Home() {
  const { t } = useTranslation("home");
  const navigate = useNavigate();

  const [isLoading, setIsLoading] = useState(false);
  const [isLoadingRandomGame, setIsLoadingRandomGame] = useState(false);
  const randomGameObjectID = useRef<string | null>(null);

  const [searchParams] = useSearchParams();

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

  const currentCategory = searchParams.get("category") || categories[0];

  const handleSelectCategory = (category: CatalogueCategory) => {
    if (category !== currentCategory) {
      getCatalogue(category);
      navigate(`/?category=${category}`);
    }
  };

  const getRandomGame = useCallback(() => {
    setIsLoadingRandomGame(true);

    window.electron.getRandomGame().then((objectID) => {
      if (objectID) {
        randomGameObjectID.current = objectID;
        setIsLoadingRandomGame(false);
      }
    });
  }, []);

  const handleRandomizerClick = () => {
    const searchParams = new URLSearchParams({
      fromRandomizer: "1",
    });

    navigate(
      `/game/steam/${randomGameObjectID.current}?${searchParams.toString()}`
    );
  };

  useEffect(() => {
    setIsLoading(true);
    getCatalogue(currentCategory as CatalogueCategory);
    getRandomGame();
  }, [getCatalogue, currentCategory, getRandomGame]);

  return (
    <SkeletonTheme baseColor={vars.color.background} highlightColor="#444">
      <section className={styles.content}>
        <h2>{t("featured")}</h2>

        <Hero />

        <section className={styles.homeHeader}>
          <div className={styles.homeCategories}>
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
            <div style={{ width: 16, height: 16, position: "relative" }}>
              <Lottie
                animationData={starsAnimation}
                style={{ width: 70, position: "absolute", top: -28, left: -27 }}
                loop
              />
            </div>
            {t("surprise_me")}
          </Button>
        </section>

        <h2>{t(currentCategory)}</h2>

        <section className={styles.cards}>
          {isLoading
            ? Array.from({ length: 12 }).map((_, index) => (
                <Skeleton key={index} className={styles.cardSkeleton} />
              ))
            : catalogue[currentCategory as CatalogueCategory].map((result) => (
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
