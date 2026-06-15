import {
  useContext,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { PencilIcon } from "@primer/octicons-react";
import { useTranslation } from "react-i18next";
import { useSearchParams } from "react-router-dom";

import { HeroPanel } from "./hero";
import { DescriptionHeader } from "./description-header/description-header";
import { GallerySlider } from "./gallery-slider/gallery-slider";
import { Sidebar } from "./sidebar/sidebar";
import { GameReviews } from "./game-reviews";
import { GameLogo } from "./game-logo";

import { AuthPage } from "@shared";
import { cloudSyncContext, gameDetailsContext } from "@renderer/context";

import cloudIconAnimated from "@renderer/assets/icons/cloud-animated.gif";
import tvEffectVideo from "@renderer/assets/emulation/tv-effect.mp4";
import { useUserDetails, useLibrary, useAppSelector } from "@renderer/hooks";
import { platformToSystem, SYSTEM_TO_BINARY } from "@renderer/helpers";
import { EMULATOR_ICONS } from "@renderer/pages/settings/emulation/emulator-icons";
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
  const [searchParams] = useSearchParams();
  const reviewsRef = useRef<HTMLDivElement>(null);

  const {
    objectId,
    shopDetails,
    game,
    hasNSFWContentBlocked,
    shop,
    setShowGameOptionsModal,
    setGameOptionsInitialCategory,
  } = useContext(gameDetailsContext);

  const { userDetails, hasActiveSubscription } = useUserDetails();
  const { library } = useLibrary();

  const { getGameArtifacts } = useContext(cloudSyncContext);

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
  const [isDescriptionExpanded, setIsDescriptionExpanded] = useState(false);
  const [isDescriptionOverflowing, setIsDescriptionOverflowing] =
    useState(false);
  const [hasUserReviewed, setHasUserReviewed] = useState(false);
  const descriptionRef = useRef<HTMLDivElement>(null);

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

  useLayoutEffect(() => {
    const el = descriptionRef.current;
    if (!el) {
      setIsDescriptionOverflowing(false);
      return;
    }

    const measure = () => {
      const collapsedMaxHeight = 300;
      setIsDescriptionOverflowing(el.scrollHeight > collapsedMaxHeight);
    };

    measure();

    const observer = new ResizeObserver(measure);
    observer.observe(el);

    const images = Array.from(el.querySelectorAll("img"));
    const onMediaLoad = () => measure();
    images.forEach((img) => {
      if (!img.complete) img.addEventListener("load", onMediaLoad);
    });

    return () => {
      observer.disconnect();
      images.forEach((img) => img.removeEventListener("load", onMediaLoad));
    };
  }, [aboutTheGame]);

  const handleCloudSaveButtonClick = () => {
    if (!userDetails) {
      window.electron.openAuthWindow(AuthPage.SignIn);
      return;
    }

    if (!hasActiveSubscription) {
      setGameOptionsInitialCategory("hydra_cloud");
      setShowGameOptionsModal(true);
      return;
    }

    setGameOptionsInitialCategory("hydra_cloud");
    setShowGameOptionsModal(true);
  };

  const handleEditGameClick = () => {
    setGameOptionsInitialCategory("assets");
    setShowGameOptionsModal(true);
  };

  useEffect(() => {
    getGameArtifacts();
  }, [getGameArtifacts]);

  // Scroll to reviews section if reviews=true in URL
  useEffect(() => {
    const shouldScrollToReviews = searchParams.get("reviews") === "true";
    if (shouldScrollToReviews && reviewsRef.current) {
      setTimeout(() => {
        reviewsRef.current?.scrollIntoView({ behavior: "smooth" });
      }, 500);
    }
  }, [searchParams, objectId]);

  const userPreferences = useAppSelector(
    (state) => state.userPreferences.value
  );
  const hideClassicsBookmark = userPreferences?.hideClassicsBookmark ?? false;
  const classicsUseHeroLayout = userPreferences?.classicsUseHeroLayout ?? false;

  const isCustomGame = game?.shop === "custom";
  const isLaunchboxGame = shop === "launchbox";
  const renderClassicsHero = isLaunchboxGame && !classicsUseHeroLayout;

  const resolvedHeroImage = isCustomGame
    ? game?.libraryHeroImageUrl || game?.iconUrl || ""
    : getImageWithCustomPriority(
        game?.customHeroImageUrl,
        shopDetails?.assets?.libraryHeroImageUrl
      );

  const launchboxCover = isLaunchboxGame
    ? game?.customIconUrl ||
      shopDetails?.assets?.libraryImageUrl ||
      game?.libraryImageUrl ||
      shopDetails?.assets?.iconUrl ||
      game?.iconUrl ||
      ""
    : "";

  const launchboxPlatform = isLaunchboxGame
    ? (game?.platform ?? shopDetails?.platform ?? null)
    : null;

  const launchboxSystem = isLaunchboxGame
    ? platformToSystem(launchboxPlatform)
    : null;

  const launchboxTitle = isLaunchboxGame
    ? (game?.title ?? shopDetails?.name ?? "")
    : "";

  const launchboxEmulatorIcon = launchboxSystem
    ? EMULATOR_ICONS[SYSTEM_TO_BINARY[launchboxSystem]]
    : undefined;

  return (
    <div
      className={`game-details__wrapper ${hasNSFWContentBlocked ? "game-details__wrapper--blurred" : ""}`}
    >
      <section className="game-details__container">
        <div
          className={`game-details__hero${renderClassicsHero ? " game-details__hero--classics-wrapper" : ""}`}
        >
          {renderClassicsHero ? (
            <>
              <div className="game-details__hero--classics">
                <div className="game-details__hero-classics-backdrop">
                  {launchboxCover && (
                    <img src={launchboxCover} alt="" aria-hidden="true" />
                  )}
                  <div className="game-details__hero-classics-backdrop-overlay" />
                </div>
              </div>
              <div className="game-details__hero-classics-content">
                <div className="game-details__hero-classics-cover">
                  {launchboxCover && (
                    <img src={launchboxCover} alt={game?.title} />
                  )}
                </div>
                <div className="game-details__hero-classics-meta">
                  <h1 className="game-details__hero-classics-title">
                    {launchboxTitle}
                  </h1>
                  {launchboxPlatform && (
                    <div className="game-details__hero-classics-chips">
                      <span className="game-details__hero-classics-chip">
                        {launchboxPlatform}
                      </span>
                      {launchboxEmulatorIcon && (
                        <span className="game-details__hero-classics-chip game-details__hero-classics-chip--icon">
                          <img src={launchboxEmulatorIcon} alt="" />
                        </span>
                      )}
                    </div>
                  )}
                </div>
              </div>
            </>
          ) : (
            <img
              src={
                isLaunchboxGame
                  ? resolvedHeroImage || launchboxCover
                  : resolvedHeroImage
              }
              className="game-details__hero-image"
              alt={game?.title}
            />
          )}

          {isLaunchboxGame && !hideClassicsBookmark && (
            <div className="game-details__hero-bookmark" aria-hidden="true">
              <div className="game-details__hero-classics-rainbow">
                <span className="game-details__hero-classics-stripe game-details__hero-classics-stripe--shadow game-details__hero-classics-stripe--orange">
                  <span className="game-details__hero-classics-stripe-band game-details__hero-classics-stripe-band--shadow" />
                </span>
                <span className="game-details__hero-classics-stripe game-details__hero-classics-stripe--shadow game-details__hero-classics-stripe--red">
                  <span className="game-details__hero-classics-stripe-band game-details__hero-classics-stripe-band--shadow" />
                </span>
                <span className="game-details__hero-classics-stripe game-details__hero-classics-stripe--shadow game-details__hero-classics-stripe--yellow">
                  <span className="game-details__hero-classics-stripe-band game-details__hero-classics-stripe-band--shadow" />
                </span>
                <span className="game-details__hero-classics-stripe game-details__hero-classics-stripe--shadow game-details__hero-classics-stripe--green">
                  <span className="game-details__hero-classics-stripe-band game-details__hero-classics-stripe-band--shadow" />
                </span>
                <span className="game-details__hero-classics-stripe game-details__hero-classics-stripe--shadow game-details__hero-classics-stripe--blue">
                  <span className="game-details__hero-classics-stripe-band game-details__hero-classics-stripe-band--shadow" />
                </span>

                <span className="game-details__hero-classics-stripe game-details__hero-classics-stripe--red">
                  <span className="game-details__hero-classics-stripe-band game-details__hero-classics-stripe-band--rtl game-details__hero-classics-stripe-band--delay-1">
                    <video
                      src={tvEffectVideo}
                      autoPlay
                      muted
                      loop
                      playsInline
                    />
                  </span>
                </span>
                <span className="game-details__hero-classics-stripe game-details__hero-classics-stripe--orange">
                  <span className="game-details__hero-classics-stripe-band game-details__hero-classics-stripe-band--ltr game-details__hero-classics-stripe-band--delay-2">
                    <video
                      src={tvEffectVideo}
                      autoPlay
                      muted
                      loop
                      playsInline
                    />
                  </span>
                </span>
                <span className="game-details__hero-classics-stripe game-details__hero-classics-stripe--yellow">
                  <span className="game-details__hero-classics-stripe-band game-details__hero-classics-stripe-band--rtl game-details__hero-classics-stripe-band--delay-3">
                    <video
                      src={tvEffectVideo}
                      autoPlay
                      muted
                      loop
                      playsInline
                    />
                  </span>
                </span>
                <span className="game-details__hero-classics-stripe game-details__hero-classics-stripe--green">
                  <span className="game-details__hero-classics-stripe-band game-details__hero-classics-stripe-band--ltr game-details__hero-classics-stripe-band--delay-4">
                    <video
                      src={tvEffectVideo}
                      autoPlay
                      muted
                      loop
                      playsInline
                    />
                  </span>
                </span>
                <span className="game-details__hero-classics-stripe game-details__hero-classics-stripe--blue">
                  <span className="game-details__hero-classics-stripe-band game-details__hero-classics-stripe-band--rtl game-details__hero-classics-stripe-band--delay-5">
                    <video
                      src={tvEffectVideo}
                      autoPlay
                      muted
                      loop
                      playsInline
                    />
                  </span>
                </span>
              </div>
            </div>
          )}

          <div
            className="game-details__hero-logo-backdrop"
            style={{ opacity: backdropOpacity }}
          >
            <div className="game-details__hero-content">
              {!renderClassicsHero && (
                <GameLogo game={game} shopDetails={shopDetails} />
              )}

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

                {game && game.shop !== "custom" && (
                  <button
                    type="button"
                    className="game-details__cloud-sync-button"
                    onClick={handleCloudSaveButtonClick}
                  >
                    <div className="game-details__cloud-icon-container">
                      <img
                        src={cloudIconAnimated}
                        alt=""
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
              ref={descriptionRef}
              dangerouslySetInnerHTML={{
                __html: aboutTheGame,
              }}
              className={`game-details__description ${
                isDescriptionExpanded
                  ? "game-details__description--expanded"
                  : isDescriptionOverflowing
                    ? "game-details__description--collapsed"
                    : ""
              }`}
            />

            {aboutTheGame && isDescriptionOverflowing && (
              <button
                type="button"
                className="game-details__description-toggle"
                onClick={() => setIsDescriptionExpanded(!isDescriptionExpanded)}
              >
                {isDescriptionExpanded ? t("show_less") : t("show_more")}
              </button>
            )}

            {shop !== "custom" && shop && objectId && (
              <div ref={reviewsRef}>
                <GameReviews
                  shop={shop}
                  objectId={objectId}
                  game={game}
                  userDetailsId={userDetails?.id}
                  isGameInLibrary={isGameInLibrary}
                  hasUserReviewed={hasUserReviewed}
                  onUserReviewedChange={setHasUserReviewed}
                />
              </div>
            )}
          </div>

          {shop !== "custom" && <Sidebar />}
        </div>
      </section>
    </div>
  );
}
