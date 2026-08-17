import {
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  PencilIcon,
  DownloadIcon,
  PeopleIcon,
  StarIcon,
  ArrowUpIcon,
} from "@primer/octicons-react";
import { useTranslation } from "react-i18next";
import { useSearchParams } from "react-router-dom";

import { HeroPanel } from "./hero";
import { HeroPanelSecondaryActions } from "./hero/hero-panel-actions";
import { GallerySlider } from "./gallery-slider/gallery-slider";
import { VideoPlayer } from "./gallery-slider/video-player";
import { Sidebar } from "./sidebar/sidebar";
import { GameReviews } from "./game-reviews";
import { GameLogo } from "./game-logo";
import { Button } from "@renderer/components";

import { AuthPage } from "@shared";
import { cloudSyncContext, gameDetailsContext } from "@renderer/context";

import cloudIconAnimated from "@renderer/assets/icons/cloud-animated.gif";
import { useUserDetails, useLibrary, useFormat } from "@renderer/hooks";
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
    achievements,
    stats,
  } = useContext(gameDetailsContext);

  const { numberFormatter } = useFormat();

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
  const [hasUserReviewed, setHasUserReviewed] = useState(false);
  const [activeTab, setActiveTab] = useState<string>("overview");

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

  const [scrollOpacity, setScrollOpacity] = useState(0);
  const [showScrollTop, setShowScrollTop] = useState(false);
  const [showVideo, setShowVideo] = useState(false);
  const videoTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const isAtTopRef = useRef(true);

  const heroVideo = useMemo(() => {
    const movies = shopDetails?.movies;
    if (!movies?.length) return null;
    const movie = movies.find((m) => m.highlight) ?? movies[0];

    if (movie.hls_h264)
      return { src: movie.hls_h264, type: "application/x-mpegURL" };
    if (movie.dash_h264)
      return { src: movie.dash_h264, type: "application/dash+xml" };
    if (movie.mp4?.max) return { src: movie.mp4.max, type: "video/mp4" };
    if (movie.mp4?.["480"]) return { src: movie.mp4["480"], type: "video/mp4" };
    if (movie.webm?.max) return { src: movie.webm.max, type: "video/webm" };
    return null;
  }, [shopDetails]);

  const heroVideoSrc = heroVideo?.src ?? null;

  const startVideoTimer = useCallback(() => {
    if (!heroVideoSrc) return;
    if (videoTimerRef.current) clearTimeout(videoTimerRef.current);
    videoTimerRef.current = setTimeout(() => {
      if (isAtTopRef.current) setShowVideo(true);
    }, 1000);
  }, [heroVideoSrc]);

  const stopVideo = useCallback(() => {
    if (videoTimerRef.current) clearTimeout(videoTimerRef.current);
    setShowVideo(false);
  }, []);

  // Start initial timer when shopDetails loads
  useEffect(() => {
    if (heroVideoSrc) startVideoTimer();
    return () => {
      if (videoTimerRef.current) clearTimeout(videoTimerRef.current);
    };
  }, [heroVideoSrc, startVideoTimer]);

  // Reset video state when navigating to a different game
  useEffect(() => {
    stopVideo();
    isAtTopRef.current = true;
    if (heroVideoSrc) startVideoTimer();
  }, [objectId]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    const content = document.getElementById("scrollableDiv");
    if (!content) return;

    const handleScroll = () => {
      const scrollY = content.scrollTop;
      const calcOpacity = Math.min(0.85, scrollY / 600);
      setScrollOpacity(calcOpacity);

      const atTop = scrollY < 50;
      if (!atTop && isAtTopRef.current) {
        // user scrolled down — stop video
        isAtTopRef.current = false;
        stopVideo();
      } else if (atTop && !isAtTopRef.current) {
        // user scrolled back to top — restart timer
        isAtTopRef.current = true;
        startVideoTimer();
      }

      if (reviewsRef.current) {
        const rect = reviewsRef.current.getBoundingClientRect();
        setShowScrollTop(rect.top < window.innerHeight);
      }
    };

    content.addEventListener("scroll", handleScroll);
    return () => content.removeEventListener("scroll", handleScroll);
  }, [stopVideo, startVideoTimer]);

  // Scroll to reviews section if reviews=true in URL
  useEffect(() => {
    const shouldScrollToReviews = searchParams.get("reviews") === "true";
    if (shouldScrollToReviews && reviewsRef.current) {
      setActiveTab("overview");
      setTimeout(() => {
        reviewsRef.current?.scrollIntoView({ behavior: "smooth" });
      }, 500);
    }
  }, [searchParams, objectId]);

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
            style={{
              opacity: showVideo ? 0 : 1,
              transition: "opacity 1s ease",
            }}
          />
          {heroVideo && (
            <div
              style={{
                opacity: showVideo ? 1 : 0,
                transition: "opacity 1s ease",
                position: "fixed",
                inset: 0,
                zIndex: 0,
                pointerEvents: "none",
              }}
            >
              <VideoPlayer
                videoSrc={heroVideo.src}
                videoType={heroVideo.type}
                autoplay
                loop
                muted
                controls={false}
                className="game-details__hero-image"
                tabIndex={-1}
              />
            </div>
          )}
          <div className="game-details__hero-image-overlay" />
          <div
            className="game-details__hero-scroll-dimmer"
            style={{
              opacity: scrollOpacity,
              position: "fixed",
              inset: 0,
              backgroundColor: "#000",
              pointerEvents: "none",
              zIndex: 1,
              transition: "opacity 0.1s",
            }}
          />

          <div
            className="game-details__hero-logo-backdrop"
            style={{ opacity: backdropOpacity, height: "100%" }}
          >
            <div
              className="game-details__hero-content"
              style={{
                display: "flex",
                flexDirection: "column",
                alignItems: "flex-start",
                width: "100%",
                flex: 1,
                justifyContent: "center",
              }}
            >
              <div
                style={{
                  display: "flex",
                  width: "100%",
                  justifyContent: "space-between",
                  alignItems: "flex-start",
                }}
              >
                <GameLogo game={game} shopDetails={shopDetails} />
              </div>

              {shopDetails && (
                <div
                  style={{
                    display: "flex",
                    gap: 12,
                    fontSize: 14,
                    color: "rgba(255,255,255,0.7)",
                    fontWeight: 500,
                    marginTop: 16,
                  }}
                >
                  {shopDetails?.publishers?.[0] && (
                    <span>{shopDetails.publishers[0]}</span>
                  )}
                  {shopDetails?.publishers?.[0] &&
                    shopDetails?.release_date?.date && <span>•</span>}
                  {shopDetails?.release_date?.date && (
                    <span>{shopDetails.release_date.date}</span>
                  )}
                </div>
              )}

              {shopDetails?.short_description && (
                <div
                  style={{
                    maxWidth: 800,
                    fontSize: 16,
                    lineHeight: 1.5,
                    color: "rgba(255,255,255,0.9)",
                    marginTop: 12,
                    marginBottom: 12,
                  }}
                  dangerouslySetInnerHTML={{
                    __html: shopDetails.short_description,
                  }}
                />
              )}

              {stats && (
                <div
                  style={{
                    display: "flex",
                    gap: 16,
                    alignItems: "center",
                    marginBottom: 16,
                    color: "rgba(255,255,255,0.4)",
                    fontWeight: 500,
                  }}
                >
                  <div
                    style={{ display: "flex", gap: 6, alignItems: "center" }}
                  >
                    <DownloadIcon size={16} />
                    <span style={{ fontSize: 14 }}>
                      {numberFormatter.format(stats?.downloadCount)}
                    </span>
                  </div>
                  <div
                    style={{ display: "flex", gap: 6, alignItems: "center" }}
                  >
                    <PeopleIcon size={16} />
                    <span style={{ fontSize: 14 }}>
                      {numberFormatter.format(stats?.playerCount)}
                    </span>
                  </div>
                  {(stats?.averageScore ?? 0) > 0 && (
                    <div
                      style={{ display: "flex", gap: 6, alignItems: "center" }}
                    >
                      <StarIcon size={16} />
                      <span style={{ fontSize: 14 }}>
                        {stats?.averageScore} / 5
                      </span>
                    </div>
                  )}
                </div>
              )}

              <div className="game-details__hero-panel">
                <HeroPanel />
              </div>
            </div>

            <hr
              style={{
                borderColor: "rgba(255,255,255,0.1)",
                margin: "32px 0 24px 0",
                width: "100%",
              }}
            />

            <div
              style={{
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
                paddingBottom: "8px",
                width: "100%",
              }}
            >
              <div
                className="game-details__tabs"
                style={{ display: "flex", gap: "8px", overflowX: "auto" }}
              >
                <Button
                  theme={activeTab === "overview" ? "primary" : "outline"}
                  onClick={() => setActiveTab("overview")}
                >
                  {t("overview") || "Visão Geral"}
                </Button>
                {shop !== "custom" && (
                  <>
                    {(userDetails === null ||
                      (achievements && achievements.length > 0)) && (
                      <Button
                        theme={
                          activeTab === "achievements" ? "primary" : "outline"
                        }
                        onClick={() => setActiveTab("achievements")}
                      >
                        Conquistas
                      </Button>
                    )}

                    <Button
                      theme={
                        activeTab === "howLongToBeat" ? "primary" : "outline"
                      }
                      onClick={() => setActiveTab("howLongToBeat")}
                    >
                      HowLongToBeat
                    </Button>

                    <Button
                      theme={activeTab === "language" ? "primary" : "outline"}
                      onClick={() => setActiveTab("language")}
                    >
                      Idioma
                    </Button>
                  </>
                )}
              </div>

              <div
                style={{ display: "flex", gap: "8px", alignItems: "center" }}
              >
                <HeroPanelSecondaryActions />

                {game && (
                  <Button
                    onClick={handleEditGameClick}
                    theme="primary"
                    title={t("edit_game_modal_button")}
                  >
                    <PencilIcon size={16} />
                  </Button>
                )}

                {game?.shop !== "custom" && (
                  <Button onClick={handleCloudSaveButtonClick} theme="primary">
                    <div
                      className="game-details__cloud-icon-container"
                      style={{
                        display: "inline-flex",
                        width: 20,
                        height: 20,
                        marginRight: 8,
                      }}
                    >
                      <img
                        src={cloudIconAnimated}
                        alt=""
                        className="game-details__cloud-icon"
                        style={{ width: "100%", height: "100%" }}
                      />
                    </div>
                    {t("cloud_save")}
                  </Button>
                )}
              </div>
            </div>
          </div>
        </div>

        <div className="game-details__content-wrapper">
          <div className="game-details__description-container">
            <div className="game-details__description-content">
              {activeTab === "overview" && (
                <div
                  style={{
                    display: "grid",
                    gridTemplateColumns: "minmax(0, 1fr) 300px",
                    gap: "32px",
                    alignItems: "start",
                  }}
                >
                  <div
                    style={{
                      display: "flex",
                      flexDirection: "column",
                      gap: "24px",
                    }}
                  >
                    <GallerySlider />

                    <div>
                      <div
                        dangerouslySetInnerHTML={{ __html: aboutTheGame }}
                        className="game-details__description"
                      />
                    </div>
                  </div>

                  <div>
                    {shop !== "custom" && <Sidebar activeTab="requirements" />}
                  </div>
                </div>
              )}

              {activeTab === "overview" &&
                shop !== "custom" &&
                shop &&
                objectId && (
                  <div
                    ref={reviewsRef}
                    style={{ width: "100%", marginTop: "32px" }}
                  >
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

            {shop !== "custom" && activeTab !== "overview" && (
              <Sidebar activeTab={activeTab} />
            )}
          </div>
        </div>

        {showScrollTop && (
          <Button
            theme="primary"
            onClick={() => {
              document
                .getElementById("scrollableDiv")
                ?.scrollTo({ top: 0, behavior: "smooth" });
            }}
            title={t("scroll_to_top") || "Voltar ao topo"}
            style={{
              position: "fixed",
              bottom: "32px",
              right: "32px",
              zIndex: 100,
              borderRadius: "50%",
              width: "48px",
              height: "48px",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              boxShadow: "0 4px 12px rgba(0,0,0,0.5)",
              animation: "fade-in 0.2s ease",
            }}
          >
            <ArrowUpIcon size={24} />
          </Button>
        )}
      </section>
    </div>
  );
}
