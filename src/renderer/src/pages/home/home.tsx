import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { useNavigate } from "react-router-dom";

import Skeleton, { SkeletonTheme } from "react-loading-skeleton";

import { Button, GameCard, Hero } from "@renderer/components";
import type { Steam250Game, CatalogueEntry } from "@types";

import starsAnimation from "@renderer/assets/lottie/stars.json";

import * as styles from "./home.css";
import { vars } from "@renderer/theme.css";
import Lottie from "lottie-react";
import { buildGameDetailsPath } from "@renderer/helpers";

export function Home() {
  const { t } = useTranslation("home");
  const navigate = useNavigate();

  const [isLoading, setIsLoading] = useState(false);
  const [randomGame, setRandomGame] = useState<Steam250Game | null>(null);

  const [catalogue, setCatalogue] = useState<CatalogueEntry[]>([]);

  const getCatalogue = useCallback(() => {
    setIsLoading(true);

    window.electron
      .getCatalogue()
      .then((catalogue) => {
        setCatalogue(catalogue);
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

  useEffect(() => {
    setIsLoading(true);
    getCatalogue();

    getRandomGame();
  }, [getCatalogue, getRandomGame]);

  return (
    <SkeletonTheme baseColor={vars.color.background} highlightColor="#444">
      <section className={styles.content}>
        <h2>{t("featured")}</h2>

        <Hero />

        <section className={styles.homeHeader}>
          <h2>{t("trending")}</h2>

          <Button
            onClick={handleRandomizerClick}
            theme="outline"
            disabled={!randomGame}
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

        <section className={styles.cards}>
          {isLoading
            ? Array.from({ length: 12 }).map((_, index) => (
                <Skeleton key={index} className={styles.cardSkeleton} />
              ))
            : catalogue.map((result) => (
                <GameCard
                  key={result.objectID}
                  game={result}
                  onClick={() => navigate(buildGameDetailsPath(result))}
                />
              ))}
        </section>
      </section>
    </SkeletonTheme>
  );
}
