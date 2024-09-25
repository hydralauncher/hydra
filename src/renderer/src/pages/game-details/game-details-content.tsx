import { useContext, useEffect, useRef, useState } from "react";
import { average } from "color.js";
import Color from "color";

import { HeroPanel } from "./hero";
import { DescriptionHeader } from "./description-header/description-header";
import { GallerySlider } from "./gallery-slider/gallery-slider";
import { Sidebar } from "./sidebar/sidebar";

import * as styles from "./game-details.css";
import { useTranslation } from "react-i18next";
import { cloudSyncContext, gameDetailsContext } from "@renderer/context";
import { steamUrlBuilder } from "@shared";
import Lottie from "lottie-react";

import downloadingAnimation from "@renderer/assets/lottie/cloud.json";

const HERO_ANIMATION_THRESHOLD = 25;

export function GameDetailsContent() {
  const heroRef = useRef<HTMLDivElement | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [isHeaderStuck, setIsHeaderStuck] = useState(false);

  const { t } = useTranslation("game_details");

  const {
    objectID,
    shopDetails,
    game,
    gameColor,
    setGameColor,
    hasNSFWContentBlocked,
  } = useContext(gameDetailsContext);

  const { supportsCloudSync, setShowCloudSyncModal } =
    useContext(cloudSyncContext);

  const [backdropOpactiy, setBackdropOpacity] = useState(1);

  const handleHeroLoad = async () => {
    const output = await average(steamUrlBuilder.libraryHero(objectID!), {
      amount: 1,
      format: "hex",
    });

    const backgroundColor = output
      ? (new Color(output).darken(0.7).toString() as string)
      : "";

    setGameColor(backgroundColor);
  };

  useEffect(() => {
    setBackdropOpacity(1);
  }, [objectID]);

  const onScroll: React.UIEventHandler<HTMLElement> = (event) => {
    const heroHeight = heroRef.current?.clientHeight ?? styles.HERO_HEIGHT;

    const scrollY = (event.target as HTMLDivElement).scrollTop;
    const opacity = Math.max(
      0,
      1 - scrollY / (heroHeight - HERO_ANIMATION_THRESHOLD)
    );

    if (scrollY >= heroHeight && !isHeaderStuck) {
      setIsHeaderStuck(true);
    }

    if (scrollY <= heroHeight && isHeaderStuck) {
      setIsHeaderStuck(false);
    }

    setBackdropOpacity(opacity);
  };

  return (
    <div className={styles.wrapper({ blurredContent: hasNSFWContentBlocked })}>
      <img
        src={steamUrlBuilder.libraryHero(objectID!)}
        className={styles.heroImage}
        alt={game?.title}
        onLoad={handleHeroLoad}
      />

      <section
        ref={containerRef}
        onScroll={onScroll}
        className={styles.container}
      >
        <div ref={heroRef} className={styles.hero}>
          <div
            style={{
              backgroundColor: gameColor,
              flex: 1,
              opacity: Math.min(1, 1 - backdropOpactiy),
            }}
          />

          <div
            className={styles.heroLogoBackdrop}
            style={{ opacity: backdropOpactiy }}
          >
            <div className={styles.heroContent}>
              <img
                src={steamUrlBuilder.logo(objectID!)}
                className={styles.gameLogo}
                alt={game?.title}
              />

              {supportsCloudSync && (
                <button
                  type="button"
                  className={styles.cloudSyncButton}
                  onClick={() => setShowCloudSyncModal(true)}
                >
                  <div
                    style={{
                      width: 16 + 4,
                      height: 16,
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      position: "relative",
                    }}
                  >
                    <Lottie
                      animationData={downloadingAnimation}
                      loop
                      autoplay
                      style={{ width: 26, position: "absolute", top: -3 }}
                    />
                  </div>
                  cloud_sync
                </button>
              )}
            </div>
          </div>
        </div>

        <HeroPanel isHeaderStuck={isHeaderStuck} />

        <div className={styles.descriptionContainer}>
          <div className={styles.descriptionContent}>
            <DescriptionHeader />
            <GallerySlider />

            <div
              dangerouslySetInnerHTML={{
                __html: shopDetails?.about_the_game ?? t("no_shop_details"),
              }}
              className={styles.description}
            />
          </div>

          <Sidebar />
        </div>
      </section>
    </div>
  );
}
