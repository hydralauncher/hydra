import { useContext, useEffect, useMemo, useRef, useState } from "react";
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

import cloudAnimation from "@renderer/assets/lottie/cloud.json";
import { useUserDetails } from "@renderer/hooks";

const HERO_ANIMATION_THRESHOLD = 25;

export function GameDetailsContent() {
  const heroRef = useRef<HTMLDivElement | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [isHeaderStuck, setIsHeaderStuck] = useState(false);

  const { t } = useTranslation("game_details");

  const {
    objectId,
    shopDetails,
    game,
    gameColor,
    setGameColor,
    hasNSFWContentBlocked,
  } = useContext(gameDetailsContext);

  const { userDetails } = useUserDetails();

  const { setShowCloudSyncModal, getGameBackupPreview, getGameArtifacts } =
    useContext(cloudSyncContext);

  const aboutTheGame = useMemo(() => {
    const aboutTheGame = shopDetails?.about_the_game;
    if (aboutTheGame) {
      const document = new DOMParser().parseFromString(
        aboutTheGame,
        "text/html"
      );

      const $images = Array.from(document.querySelectorAll("img"));
      $images.forEach(($image) => {
        $image.loading = "lazy";
      });

      return document.body.outerHTML;
    }

    return t("no_shop_details");
  }, [shopDetails, t]);

  const [backdropOpactiy, setBackdropOpacity] = useState(1);

  const handleHeroLoad = async () => {
    const output = await average(steamUrlBuilder.libraryHero(objectId!), {
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
  }, [objectId]);

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

  const handleCloudSaveButtonClick = () => {
    if (!userDetails) {
      window.electron.openAuthWindow();
      return;
    }

    setShowCloudSyncModal(true);
  };

  useEffect(() => {
    getGameBackupPreview();
    getGameArtifacts();
  }, [getGameBackupPreview, getGameArtifacts]);

  return (
    <div className={styles.wrapper({ blurredContent: hasNSFWContentBlocked })}>
      <img
        src={steamUrlBuilder.libraryHero(objectId!)}
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
                src={steamUrlBuilder.logo(objectId!)}
                className={styles.gameLogo}
                alt={game?.title}
              />

              <button
                type="button"
                className={styles.cloudSyncButton}
                onClick={handleCloudSaveButtonClick}
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
                    animationData={cloudAnimation}
                    loop
                    autoplay
                    style={{ width: 26, position: "absolute", top: -3 }}
                  />
                </div>
                {t("cloud_save")}
              </button>
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
                __html: aboutTheGame,
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
