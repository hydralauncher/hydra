import { useEffect, useState } from "react";
import { useNavigate, useParams, useSearchParams } from "react-router-dom";
import { average } from "color.js";

import { Steam250Game } from "@types";

import { Button } from "@renderer/components";
import { buildGameDetailsPath, steamUrlBuilder } from "@renderer/helpers";

import starsAnimation from "@renderer/assets/lottie/stars.json";

import Lottie from "lottie-react";
import { useTranslation } from "react-i18next";
import { SkeletonTheme } from "react-loading-skeleton";
import { DescriptionHeader } from "./description-header";
import { GameDetailsSkeleton } from "./game-details-skeleton";
import * as styles from "./game-details.css";
import { HeroPanel } from "./hero";

import { vars } from "../../theme.css";

import { GallerySlider } from "./gallery-slider";
import { Sidebar } from "./sidebar/sidebar";
import {
  GameDetailsContextConsumer,
  GameDetailsContextProvider,
} from "./game-details.context";

export function GameDetails() {
  const [randomGame, setRandomGame] = useState<Steam250Game | null>(null);

  const { objectID } = useParams();
  const [searchParams] = useSearchParams();

  const fromRandomizer = searchParams.get("fromRandomizer");

  const { t } = useTranslation("game_details");

  const navigate = useNavigate();

  useEffect(() => {
    setRandomGame(null);
    window.electron.getRandomGame().then((randomGame) => {
      setRandomGame(randomGame);
    });
  }, [objectID]);

  const handleRandomizerClick = () => {
    if (randomGame) {
      navigate(
        buildGameDetailsPath(
          { ...randomGame, shop: "steam" },
          { fromRandomizer: "1" }
        )
      );
    }
  };

  return (
    <GameDetailsContextProvider>
      <GameDetailsContextConsumer>
        {({ game, shopDetails, isLoading, setGameColor }) => {
          const handleHeroLoad = async () => {
            const output = await average(
              steamUrlBuilder.libraryHero(objectID!),
              {
                amount: 1,
                format: "hex",
              }
            );

            setGameColor(output as string);
          };

          return (
            <SkeletonTheme
              baseColor={vars.color.background}
              highlightColor="#444"
            >
              {isLoading ? (
                <GameDetailsSkeleton />
              ) : (
                <section className={styles.container}>
                  <div className={styles.hero}>
                    <img
                      src={steamUrlBuilder.libraryHero(objectID!)}
                      className={styles.heroImage}
                      alt={game?.title}
                      onLoad={handleHeroLoad}
                    />
                    <div className={styles.heroBackdrop}>
                      <div className={styles.heroContent}>
                        <img
                          src={steamUrlBuilder.logo(objectID!)}
                          style={{ width: 300, alignSelf: "flex-end" }}
                          alt={game?.title}
                        />
                      </div>
                    </div>
                  </div>

                  <HeroPanel />

                  <div className={styles.descriptionContainer}>
                    <div className={styles.descriptionContent}>
                      <DescriptionHeader />
                      <GallerySlider />

                      <div
                        dangerouslySetInnerHTML={{
                          __html:
                            shopDetails?.about_the_game ?? t("no_shop_details"),
                        }}
                        className={styles.description}
                      />
                    </div>

                    <Sidebar />
                  </div>
                </section>
              )}

              {fromRandomizer && (
                <Button
                  className={styles.randomizerButton}
                  onClick={handleRandomizerClick}
                  theme="outline"
                  disabled={!randomGame}
                >
                  <div style={{ width: 16, height: 16, position: "relative" }}>
                    <Lottie
                      animationData={starsAnimation}
                      style={{
                        width: 70,
                        position: "absolute",
                        top: -28,
                        left: -27,
                      }}
                      loop
                    />
                  </div>
                  {t("next_suggestion")}
                </Button>
              )}
            </SkeletonTheme>
          );
        }}
      </GameDetailsContextConsumer>
    </GameDetailsContextProvider>
  );
}
