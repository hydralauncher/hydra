import { useContext, useEffect, useMemo, useRef, useState } from "react";
import { PencilIcon } from "@primer/octicons-react";

import { HeroPanel } from "./hero";
import { DescriptionHeader } from "./description-header/description-header";
import { GallerySlider } from "./gallery-slider/gallery-slider";
import { Sidebar } from "./sidebar/sidebar";
import { EditGameModal } from "./modals";

import { useTranslation } from "react-i18next";
import { cloudSyncContext, gameDetailsContext } from "@renderer/context";
import { AuthPage } from "@shared";

import cloudIconAnimated from "@renderer/assets/icons/cloud-animated.gif";
import { useUserDetails, useLibrary } from "@renderer/hooks";
import { useSubscription } from "@renderer/hooks/use-subscription";
import "./game-details.scss";

export function GameDetailsContent() {
  const heroRef = useRef<HTMLDivElement | null>(null);

  const { t } = useTranslation("game_details");

  const { objectId, shopDetails, game, hasNSFWContentBlocked, updateGame } =
    useContext(gameDetailsContext);

  const { showHydraCloudModal } = useSubscription();

  const { userDetails, hasActiveSubscription } = useUserDetails();
  const { updateLibrary } = useLibrary();

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
        // Remove any inline width/height styles that might cause overflow
        $image.removeAttribute("width");
        $image.removeAttribute("height");
        $image.removeAttribute("style");
        // Set max-width to prevent overflow
        $image.style.maxWidth = "100%";
        $image.style.width = "auto";
        $image.style.height = "auto";
        $image.style.boxSizing = "border-box";
      });

      // Handle videos the same way
      const $videos = Array.from(document.querySelectorAll("video"));
      $videos.forEach(($video) => {
        // Remove any inline width/height styles that might cause overflow
        $video.removeAttribute("width");
        $video.removeAttribute("height");
        $video.removeAttribute("style");
        // Set max-width to prevent overflow
        $video.style.maxWidth = "100%";
        $video.style.width = "auto";
        $video.style.height = "auto";
        $video.style.boxSizing = "border-box";
      });

      return document.body.outerHTML;
    }

    if (game?.shop === "custom") {
      return "";
    }

    return t("no_shop_details");
  }, [shopDetails, t, game?.shop]);

  const [backdropOpacity, setBackdropOpacity] = useState(1);
  const [showEditGameModal, setShowEditGameModal] = useState(false);

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

  const handleEditGameClick = () => {
    setShowEditGameModal(true);
  };

  const handleGameUpdated = (_updatedGame: any) => {
    updateGame();
    updateLibrary();
  };

  useEffect(() => {
    getGameArtifacts();
  }, [getGameArtifacts]);

  const isCustomGame = game?.shop === "custom";

  // Helper function to get image with custom asset priority
  const getImageWithCustomPriority = (
    customUrl: string | null | undefined,
    originalUrl: string | null | undefined,
    fallbackUrl?: string | null | undefined
  ) => {
    return customUrl || originalUrl || fallbackUrl || "";
  };

  const heroImage = isCustomGame
    ? game?.libraryHeroImageUrl || game?.iconUrl || ""
    : getImageWithCustomPriority(
        game?.customHeroImageUrl,
        shopDetails?.assets?.libraryHeroImageUrl
      );

  const logoImage = isCustomGame
    ? game?.logoImageUrl || ""
    : getImageWithCustomPriority(
        game?.customLogoImageUrl,
        shopDetails?.assets?.logoImageUrl
      );

  const renderGameLogo = () => {
    if (isCustomGame) {
      // For custom games, show logo image if available, otherwise show game title as text
      if (logoImage) {
        return (
          <img
            src={logoImage}
            className="game-details__game-logo"
            alt={game?.title}
          />
        );
      } else {
        return (
          <div className="game-details__game-logo-text">{game?.title}</div>
        );
      }
    } else {
      // For non-custom games, show logo image if available
      return logoImage ? (
        <img
          src={logoImage}
          className="game-details__game-logo"
          alt={game?.title}
        />
      ) : null;
    }
  };

  return (
    <div
      className={`game-details__wrapper ${hasNSFWContentBlocked ? "game-details__wrapper--blurred" : ""}`}
    >
      <section className="game-details__container">
        <div ref={heroRef} className="game-details__hero">
          <img
            src={heroImage}
            className="game-details__hero-image"
            alt={game?.title}
          />
          <div
            className="game-details__hero-backdrop"
            style={{
              flex: 1,
            }}
          />

          <div
            className="game-details__hero-logo-backdrop"
            style={{ opacity: backdropOpacity }}
          >
            <div className="game-details__hero-content">
              {renderGameLogo()}

              <div className="game-details__hero-buttons game-details__hero-buttons--right">
                {game && (
                  <button
                    type="button"
                    className="game-details__edit-custom-game-button"
                    onClick={handleEditGameClick}
                    title={t("edit_game_modal_button")}
                  >
                    <PencilIcon size={16} />
                  </button>
                )}

                {game?.shop !== "custom" && (
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
                )}
              </div>
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

          {game?.shop !== "custom" && <Sidebar />}
        </div>
      </section>

      {game && (
        <EditGameModal
          visible={showEditGameModal}
          onClose={() => setShowEditGameModal(false)}
          game={game}
          shopDetails={shopDetails}
          onGameUpdated={handleGameUpdated}
        />
      )}
    </div>
  );
}
