import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { useNavigate } from "react-router-dom";

import Skeleton, { SkeletonTheme } from "react-loading-skeleton";

import { Button, GameCard, Hero } from "@renderer/components";
import type { Steam250Game, CatalogueEntry } from "@types";

import flameIconStatic from "@renderer/assets/icons/flame-static.png";
import flameIconAnimated from "@renderer/assets/icons/flame-animated.gif";
import starsIconAnimated from "@renderer/assets/icons/stars-animated.gif";

import * as styles from "./home.css";
import { SPACING_UNIT, vars } from "@renderer/theme.css";
import { buildGameDetailsPath } from "@renderer/helpers";
import { CatalogueCategory } from "@shared";

export default function Home() {
  const { t } = useTranslation("home");
  const navigate = useNavigate();

  const [animateFlame, setAnimateFlame] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [randomGame, setRandomGame] = useState<Steam250Game | null>(null);

  const [currentCatalogueCategory, setCurrentCatalogueCategory] = useState(
    CatalogueCategory.Hot
  );

  const [catalogue, setCatalogue] = useState<
    Record<CatalogueCategory, CatalogueEntry[]>
  >({
    [CatalogueCategory.Hot]: [],
    [CatalogueCategory.Weekly]: [],
    [CatalogueCategory.Achievements]: [],
  });

  const getCatalogue = useCallback((category: CatalogueCategory) => {
    setCurrentCatalogueCategory(category);
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

  const handleCategoryClick = (category: CatalogueCategory) => {
    if (category !== currentCatalogueCategory) {
      getCatalogue(category);
    }
  };

  useEffect(() => {
    setIsLoading(true);
    getCatalogue(CatalogueCategory.Hot);

    getRandomGame();
  }, [getCatalogue, getRandomGame]);

  const categories = Object.values(CatalogueCategory);

  const handleMouseEnterCategory = (category: CatalogueCategory) => {
    if (category === CatalogueCategory.Hot) {
      setAnimateFlame(true);
    }
  };

  const handleMouseLeaveCategory = (category: CatalogueCategory) => {
    if (category === CatalogueCategory.Hot) {
      setAnimateFlame(false);
    }
  };

  return (
    <SkeletonTheme baseColor={vars.color.background} highlightColor="#444">
      <section className={styles.content}>
        <h2>{t("featured")}</h2>

        <Hero />

        <section className={styles.homeHeader}>
          <ul className={styles.buttonsList}>
            {categories.map((category) => (
              <li key={category}>
                <Button
                  theme={
                    category === currentCatalogueCategory
                      ? "primary"
                      : "outline"
                  }
                  onClick={() => handleCategoryClick(category)}
                  onMouseEnter={() => handleMouseEnterCategory(category)}
                  onMouseLeave={() => handleMouseLeaveCategory(category)}
                >
                  {category === CatalogueCategory.Hot && (
                    <div
                      style={{ width: 16, height: 16, position: "relative" }}
                    >
                      <img
                        src={flameIconStatic}
                        alt="Flame icon"
                        className={styles.flameIcon}
                        style={{ display: animateFlame ? "none" : "block" }}
                      />
                      <img
                        src={flameIconAnimated}
                        alt="Flame animation"
                        className={styles.flameIcon}
                        style={{ display: animateFlame ? "block" : "none" }}
                      />
                    </div>
                  )}

                  {t(category)}
                </Button>
              </li>
            ))}
          </ul>

          <Button
            onClick={handleRandomizerClick}
            theme="outline"
            disabled={!randomGame}
          >
            <div style={{ width: 16, height: 16, position: "relative" }}>
              <img
                src={starsIconAnimated}
                alt="Stars animation"
                style={{ width: 70, position: "absolute", top: -28, left: -27 }}
              />
            </div>
            {t("surprise_me")}
          </Button>
        </section>

        <h2 style={{ display: "flex", gap: SPACING_UNIT }}>
          {currentCatalogueCategory === CatalogueCategory.Hot && (
            <div style={{ width: 24, height: 24, position: "relative" }}>
              <img
                src={flameIconAnimated}
                alt="Flame animation"
                style={{
                  width: 40,
                  top: -10,
                  left: -5,
                  position: "absolute",
                }}
              />
            </div>
          )}

          {t(currentCatalogueCategory)}
        </h2>

        <section className={styles.cards}>
          {isLoading
            ? Array.from({ length: 12 }).map((_, index) => (
                <Skeleton key={index} className={styles.cardSkeleton} />
              ))
            : catalogue[currentCatalogueCategory].map((result) => (
                <GameCard
                  key={result.objectId}
                  game={result}
                  onClick={() => navigate(buildGameDetailsPath(result))}
                />
              ))}
        </section>
      </section>
    </SkeletonTheme>
  );
}
