import { useContext, useEffect, useMemo, useRef, useState } from "react";
import { average } from "color.js";
import Color from "color";

import { HeroPanel } from "./hero";
import { DescriptionHeader } from "./description-header/description-header";
import { GallerySlider } from "./gallery-slider/gallery-slider";
import { Sidebar } from "./sidebar/sidebar";

import "./game-details.scss";
import { useTranslation } from "react-i18next";
import { cloudSyncContext, gameDetailsContext } from "@renderer/context";
import { AuthPage, steamUrlBuilder } from "@shared";

import cloudIconAnimated from "@renderer/assets/icons/cloud-animated.gif";
import { useUserDetails } from "@renderer/hooks";
import { useSubscription } from "@renderer/hooks/use-subscription";

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
  } = useContext(gameDetailsContext);

  const { showHydraCloudModal } = useSubscription();

  const { userDetails, hasActiveSubscription } = useUserDetails();

  const { setShowCloudSyncModal, getGameArtifacts } =
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
      ? new Color(output).darken(0.7).toString()
      : "";

    setGameColor(backgroundColor);
  };

  useEffect(() => {
    setBackdropOpacity(1);
  }, [objectId]);
  const HERO_HEIGHT = 150; 

  const onScroll: React.UIEventHandler<HTMLElement> = (event) => {
  const heroHeight = heroRef.current?.clientHeight ?? HERO_HEIGHT;

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
      window.electron.openAuthWindow(AuthPage.SignIn);
      return;
    }

    if (!hasActiveSubscription) {
      showHydraCloudModal("backup");
      return;
    }

    setShowCloudSyncModal(true);
  };

  useEffect(() => {
    getGameArtifacts();
  }, [getGameArtifacts]);

  return (
    <div className="game-details__blurred-content">
      <img
        src={steamUrlBuilder.libraryHero(objectId!)}
        className="game-details__hero-image"
        alt={game?.title}
        onLoad={handleHeroLoad}
      />

      <section
        ref={containerRef}
        onScroll={onScroll}
        className="game-details__container"
      >
        <div ref={heroRef} className="game-details__hero">
          <div
            style={{
              backgroundColor: gameColor,
              flex: 1,
              opacity: Math.min(1, 1 - backdropOpactiy),
            }}
          />

          <div
            className="game-details__hero-logo-backdrop"
            style={{ opacity: backdropOpactiy }}
          >
            <div className="game-details__hero-content">
              <img
                src={steamUrlBuilder.logo(objectId!)}
                className="game-details__game-logo"
                alt={game?.title}
              />

              <button
                type="button"
                className="game-details__cloud-sync-button"
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
                  <img
                    src={cloudIconAnimated}
                    alt="Cloud icon"
                    style={{ width: 26, position: "absolute", top: -3 }}
                  />
                </div>
                {t("cloud_save")}
              </button>
            </div>
          </div>
        </div>

        <HeroPanel isHeaderStuck={isHeaderStuck} />

        <div className="game-details__description-container">
          <div className="game-details__description-content">
            <DescriptionHeader />
            <GallerySlider />

            <div
              dangerouslySetInnerHTML={{
                __html: aboutTheGame,
              }}
              className="game-details__description"
            />
          </div>

          <Sidebar />
        </div>
      </section>
    </div>
  );
}
