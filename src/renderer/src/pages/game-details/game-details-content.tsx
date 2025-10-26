import { useContext, useEffect, useMemo, useState } from "react";
import { PencilIcon } from "@primer/octicons-react";
import { useTranslation } from "react-i18next";

import { HeroPanel } from "./hero";
import { DescriptionHeader } from "./description-header/description-header";
import { GallerySlider } from "./gallery-slider/gallery-slider";
import { Sidebar } from "./sidebar/sidebar";
import { EditGameModal } from "./modals";
import { GameReviews } from "./game-reviews";
import { GameLogo } from "./game-logo";

import { AuthPage } from "@shared";
import { cloudSyncContext, gameDetailsContext } from "@renderer/context";

import cloudIconAnimated from "@renderer/assets/icons/cloud-animated.gif";
import { useUserDetails, useLibrary } from "@renderer/hooks";
import { useSubscription } from "@renderer/hooks/use-subscription";
import "./game-details.scss";
import "./hero.scss";

const processMediaElements = (document: Document) => {
  const $images = Array.from(document.querySelectorAll("img"));
  $images.forEach(($image) => {
    $image.loading = "lazy";
    $image.removeAttribute("width");
    $image.removeAttribute("height");
    $image.removeAttribute("style");
    $image.style.maxWidth = "100%";
    $image.style.width = "auto";
    $image.style.height = "auto";
    $image.style.boxSizing = "border-box";
  });

  // Handle videos the same way
  const $videos = Array.from(document.querySelectorAll("video"));
  $videos.forEach(($video) => {
    $video.removeAttribute("width");
    $video.removeAttribute("height");
    $video.removeAttribute("style");
    $video.style.maxWidth = "100%";
    $video.style.width = "auto";
    $video.style.height = "auto";
    $video.style.boxSizing = "border-box";
  });
};

const getImageWithCustomPriority = (
  customUrl: string | null | undefined,
  originalUrl: string | null | undefined,
  fallbackUrl?: string | null | undefined
) => {
  return customUrl || originalUrl || fallbackUrl || "";
};

export function GameDetailsContent() {
  const { t } = useTranslation("game_details");

  const {
    objectId,
    shopDetails,
    game,
    hasNSFWContentBlocked,
    updateGame,
    shop,
  } = useContext(gameDetailsContext);

  const { showHydraCloudModal } = useSubscription();

  const { userDetails, hasActiveSubscription } = useUserDetails();
  const { updateLibrary, library } = useLibrary();

  const { setShowCloudSyncModal, getGameArtifacts } =
    useContext(cloudSyncContext);

  const aboutTheGame = useMemo(() => {
    const aboutTheGame = shopDetails?.about_the_game;
    if (aboutTheGame) {
      const document = new DOMParser().parseFromString(
        aboutTheGame,
        "text/html"
      );

      processMediaElements(document);

      return document.body.outerHTML;
    }

    if (game?.shop === "custom") {
      return "";
    }

    return t("no_shop_details");
  }, [shopDetails, t, game?.shop]);

  const [backdropOpacity, setBackdropOpacity] = useState(1);
  const [showEditGameModal, setShowEditGameModal] = useState(false);
  const [isDescriptionExpanded, setIsDescriptionExpanded] = useState(false);
  const [hasUserReviewed, setHasUserReviewed] = useState(false);

  // Check if the current game is in the user's library
  const isGameInLibrary = useMemo(() => {
    if (!library || !shop || !objectId) return false;
    return library.some(
      (libItem) => libItem.shop === shop && libItem.objectId === objectId
    );
  }, [library, shop, objectId]);

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

  const handleGameUpdated = () => {
    updateGame();
    updateLibrary();
  };

  useEffect(() => {
    getGameArtifacts();
  }, [getGameArtifacts]);

  const isCustomGame = game?.shop === "custom";

  const heroImage = isCustomGame
    ? game?.libraryHeroImageUrl || game?.iconUrl || ""
    : getImageWithCustomPriority(
        game?.customHeroImageUrl,
        shopDetails?.assets?.libraryHeroImageUrl
      );

  return (
    <div
      className={`game-details__wrapper ${hasNSFWContentBlocked ? "game-details__wrapper--blurred" : ""}`}
    >
      <section className="game-details__container">
        <div className="game-details__hero">
          <img
            src={heroImage}
            className="game-details__hero-image"
            alt={game?.title}
          />

          <div
            className="game-details__hero-logo-backdrop"
            style={{ opacity: backdropOpacity }}
          >
            <div className="game-details__hero-content">
              <GameLogo game={game} shopDetails={shopDetails} />

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

            <div className="game-details__hero-panel">
              <HeroPanel />
            </div>
          </div>
        </div>

        <div className="game-details__description-container">
          <div className="game-details__description-content">
            <DescriptionHeader />
            <GallerySlider />

            <div
              dangerouslySetInnerHTML={{
                __html: aboutTheGame,
              }}
              className={`game-details__description ${
                isDescriptionExpanded
                  ? "game-details__description--expanded"
                  : "game-details__description--collapsed"
              }`}
            />

            {aboutTheGame && aboutTheGame.length > 500 && (
              <button
                type="button"
                className="game-details__description-toggle"
                onClick={() => setIsDescriptionExpanded(!isDescriptionExpanded)}
              >
                {isDescriptionExpanded ? t("show_less") : t("show_more")}
              </button>
            )}

            {game?.shop !== "custom" && shop && objectId && (
              <GameReviews
                shop={shop}
                objectId={objectId}
                game={game}
                userDetailsId={userDetails?.id}
                isGameInLibrary={isGameInLibrary}
                hasUserReviewed={hasUserReviewed}
                onUserReviewedChange={setHasUserReviewed}
              />
            )}
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
