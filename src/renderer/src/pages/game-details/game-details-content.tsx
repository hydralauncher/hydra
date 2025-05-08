import { useContext, useEffect, useMemo, useRef, useState } from "react";
import { average } from "color.js";
import Color from "color";

import { HeroPanel } from "./hero";
import { DescriptionHeader } from "./description-header/description-header";
import { GallerySlider } from "./gallery-slider/gallery-slider";
import { Sidebar } from "./sidebar/sidebar";

import { useTranslation } from "react-i18next";
import { cloudSyncContext, gameDetailsContext } from "@renderer/context";
import { AuthPage } from "@shared";

import cloudIconAnimated from "@renderer/assets/icons/cloud-animated.gif";
import { useUserDetails } from "@renderer/hooks";
import { useSubscription } from "@renderer/hooks/use-subscription";
import "./game-details.scss";

export function GameDetailsContent() {
  const heroRef = useRef<HTMLDivElement | null>(null);

  const { t } = useTranslation("game_details");

  const {
    objectId,
    shopDetails,
    game,
    gameColor,
    setGameColor,
    hasNSFWContentBlocked,
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

  const [backdropOpacity, setBackdropOpacity] = useState(1);

  const handleHeroLoad = async () => {
    const output = await average(shopDetails?.libraryHeroImageUrl ?? "", {
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
    <div
      className={`game-details__wrapper ${hasNSFWContentBlocked ? "game-details__wrapper--blurred" : ""}`}
    >
      <section className="game-details__container">
        <div ref={heroRef} className="game-details__hero">
          <img
            src={shopDetails?.libraryHeroImageUrl ?? ""}
            className="game-details__hero-image"
            alt={game?.title}
            onLoad={handleHeroLoad}
          />
          <div
            className="game-details__hero-backdrop"
            style={{
              backgroundColor: gameColor,
              flex: 1,
            }}
          />

          <div
            className="game-details__hero-logo-backdrop"
            style={{ opacity: backdropOpacity }}
          >
            <div className="game-details__hero-content">
              <img
                src={shopDetails?.logoImageUrl ?? ""}
                className="game-details__game-logo"
                alt={game?.title}
              />

              <button
                type="button"
                className="game-details__cloud-sync-button"
                onClick={handleCloudSaveButtonClick}
              >
                <div className="game-details__cloud-icon-container">
                  <img
                    src={cloudIconAnimated}
                    alt="Cloud icon"
                    className="game-details__cloud-icon"
                  />
                </div>
                {t("cloud_save")}
              </button>
            </div>
          </div>
        </div>

        <HeroPanel />

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
