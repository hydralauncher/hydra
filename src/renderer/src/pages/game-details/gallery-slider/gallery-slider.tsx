import {
  useContext,
  useCallback,
  useMemo,
  useState,
  useEffect,
  useRef,
} from "react";
import { createPortal } from "react-dom";
import cn from "classnames";
import { useTranslation } from "react-i18next";
import { ChevronRightIcon, ChevronLeftIcon } from "@primer/octicons-react";
import { CornersOut, Play } from "@phosphor-icons/react";
import useEmblaCarousel from "embla-carousel-react";
import { Tooltip } from "react-tooltip";
import { gameDetailsContext } from "@renderer/context";
import { useAppSelector } from "@renderer/hooks";
import {
  GALLERY_PAGE_TOOLTIP_ID,
  SEEK_STEP_SECONDS,
  resolveMediaKey,
  GalleryVideoPlayer,
  type GalleryPlaybackState,
  type GalleryVideoPlayerHandle,
} from "./gallery-video-player";
import { GalleryVideoHost, GalleryVideoSlot } from "./gallery-video-host";
import { getSteamMovieSource } from "./gallery-media-sources";
import { shouldSpaceTogglePlayback } from "./gallery-playback";
import { useDragScroll } from "./use-drag-scroll";
import {
  hasShortcutModifier,
  isDialogOpen,
  isEditableTarget,
  normalizeShortcutKey,
} from "./gallery-shortcuts";
import {
  GalleryLightbox,
  type GalleryViewerPresentation,
} from "./gallery-lightbox";
import "./gallery-slider.scss";

export interface GalleryVideoSource {
  label: string;
  src: string;
  type: string;
}

export interface GalleryMediaItem {
  id: string;
  type: "video" | "image";
  src?: string;
  thumbnail?: string;
  poster?: string;
  videoSrc?: string;
  videoType?: string;
  sources?: GalleryVideoSource[];
  alt: string;
}

export function GallerySlider() {
  const { shopDetails } = useContext(gameDetailsContext);
  const { t } = useTranslation("game_details");
  const userPreferences = useAppSelector(
    (state) => state.userPreferences.value
  );
  const autoplayEnabled = userPreferences?.autoplayGameTrailers !== false;

  const hasScreenshots = shopDetails && shopDetails.screenshots?.length;

  const [emblaRef, emblaApi] = useEmblaCarousel({
    loop: false,
    watchDrag: (_api, event) =>
      !document.fullscreenElement &&
      !(event.target as Element | null)?.closest("[data-gallery-chrome]"),
  });
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [lightbox, setLightbox] = useState<{
    index: number;
    fullscreen: boolean;
    chromeHidden: boolean;
  } | null>(null);
  const [presentation, setPresentation] =
    useState<GalleryViewerPresentation | null>(null);
  const [videoHoldsChrome, setVideoHoldsChrome] = useState(true);
  const mediaItemsRef = useRef<GalleryMediaItem[]>([]);
  const previewDrag = useDragScroll();
  const playerHandlesRef = useRef(new Map<string, GalleryVideoPlayerHandle>());
  const toggleViewerFullscreenRef = useRef<(() => void) | null>(null);

  const scrollPrev = useCallback(() => {
    if (emblaApi) emblaApi.scrollPrev();
  }, [emblaApi]);

  const scrollNext = useCallback(() => {
    if (emblaApi) emblaApi.scrollNext();
  }, [emblaApi]);

  const scrollTo = useCallback(
    (index: number) => {
      if (emblaApi) emblaApi.scrollTo(index);
    },
    [emblaApi]
  );

  const scrollToPreview = useCallback(
    (index: number, event: React.MouseEvent<HTMLButtonElement>) => {
      scrollTo(index);

      const button = event.currentTarget;
      const previewContainer = button.parentElement;

      if (previewContainer) {
        const containerRect = previewContainer.getBoundingClientRect();
        const buttonRect = button.getBoundingClientRect();

        const isOffScreenLeft = buttonRect.left < containerRect.left;
        const isOffScreenRight = buttonRect.right > containerRect.right;

        if (isOffScreenLeft || isOffScreenRight) {
          button.scrollIntoView({
            behavior: "smooth",
            block: "nearest",
            inline: "center",
          });
        }
      }
    },
    [scrollTo]
  );

  useEffect(() => {
    if (!emblaApi) return;

    const onSelect = () => {
      const newIndex = emblaApi.selectedScrollSnap();
      setSelectedIndex(newIndex);

      const selectedId = mediaItemsRef.current[newIndex]?.id;
      playerHandlesRef.current.forEach((handle, id) => {
        if (id === selectedId && autoplayEnabled) {
          handle.play();
        } else {
          handle.pause();
        }
      });
    };

    emblaApi.on("select", onSelect);
    onSelect();

    return () => {
      emblaApi.off("select", onSelect);
    };
  }, [emblaApi, autoplayEnabled]);

  const mediaItems = useMemo(() => {
    const items: GalleryMediaItem[] = [];

    if (shopDetails?.movies) {
      shopDetails.movies.forEach((video, index) => {
        const movieSource = getSteamMovieSource(video);
        if (!movieSource) return;

        items.push({
          id: String(video.id),
          type: "video",
          poster: video.thumbnail,
          thumbnail: video.thumbnail,
          ...movieSource,
          alt: video.name || t("video", { number: String(index + 1) }),
        });
      });
    }

    if (shopDetails?.screenshots) {
      shopDetails.screenshots.forEach((image, index) => {
        items.push({
          id: String(image.id),
          type: "image",
          src: image.path_full,
          thumbnail: image.path_thumbnail,
          alt: t("screenshot", { number: String(index + 1) }),
        });
      });
    }

    return items;
  }, [shopDetails, t]);

  const previews = useMemo(() => {
    const screenshotPreviews =
      shopDetails?.screenshots?.map(({ id, path_thumbnail }) => ({
        id,
        thumbnail: path_thumbnail,
        type: "image" as const,
      })) ?? [];

    if (shopDetails?.movies) {
      const moviePreviews = shopDetails.movies.map(({ id, thumbnail }) => ({
        id,
        thumbnail,
        type: "video" as const,
      }));

      return [...moviePreviews, ...screenshotPreviews];
    }

    return screenshotPreviews;
  }, [shopDetails]);

  const videoHostsRef = useRef(new Map<string, GalleryVideoHost>());
  mediaItemsRef.current = mediaItems;

  const videoHosts = useMemo(() => {
    const hosts = videoHostsRef.current;
    mediaItems.forEach((item) => {
      if (item.type === "video" && !hosts.has(item.id)) {
        hosts.set(item.id, new GalleryVideoHost());
      }
    });
    return hosts;
  }, [mediaItems]);

  const getVideoHandle = useCallback(
    (id: string) => playerHandlesRef.current.get(id),
    []
  );

  const openLightbox = useCallback(
    (index: number, fullscreen: boolean) => {
      const target = mediaItems[index];

      mediaItems.forEach((item) => {
        if (item.type === "video" && item.id !== target?.id) {
          playerHandlesRef.current.get(item.id)?.pause();
        }
      });

      const controls =
        target?.type === "video"
          ? playerHandlesRef.current.get(target.id)?.getControlsState()
          : undefined;
      const chromeHidden = controls?.hidden ?? false;

      setVideoHoldsChrome(controls?.held ?? true);
      setPresentation({
        isFullscreen: fullscreen,
        chromeHidden,
        activeVideoId: target?.type === "video" ? target.id : null,
        borrowedVideoIds: [],
      });
      setLightbox({ index, fullscreen, chromeHidden });
    },
    [mediaItems]
  );

  const closeLightbox = useCallback(
    (index: number, playback?: GalleryPlaybackState) => {
      setLightbox(null);
      setPresentation(null);
      if (!emblaApi) return;

      if (emblaApi.selectedScrollSnap() !== index) {
        emblaApi.scrollTo(index, true);
      }

      window.setTimeout(() => {
        const closedItem = mediaItems[index];
        const handle = closedItem
          ? playerHandlesRef.current.get(closedItem.id)
          : undefined;
        if (playback && handle) handle.restore(playback);
      }, 0);
    },
    [emblaApi, mediaItems]
  );

  const navigateLightbox = useCallback((index: number) => {
    setLightbox((current) => current && { ...current, index });
  }, []);

  const firstVideoIndex = useMemo(
    () => mediaItems.findIndex((item) => item.type === "video"),
    [mediaItems]
  );

  const viewerItemId = lightbox ? mediaItems[lightbox.index]?.id : undefined;

  const containerRef = useRef<HTMLDivElement>(null);
  const inViewRef = useRef(false);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return undefined;

    const observer = new IntersectionObserver(([entry]) => {
      inViewRef.current = entry.isIntersecting;
    });
    observer.observe(container);

    return () => observer.disconnect();
  }, [hasScreenshots]);

  useEffect(() => {
    if (lightbox) return undefined;

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.defaultPrevented || hasShortcutModifier(event)) return;
      if (!inViewRef.current || isEditableTarget(event.target)) return;
      if (isDialogOpen()) return;

      const item = mediaItems[selectedIndex];
      if (!item) return;

      const video =
        item.type === "video"
          ? playerHandlesRef.current.get(item.id)
          : undefined;

      const shortcuts: Record<string, () => boolean> = {
        f: () => {
          openLightbox(selectedIndex, true);
          return true;
        },
        m: () => {
          video?.toggleMute();
          return Boolean(video);
        },
        " ": () => {
          if (!video) return false;
          if (!shouldSpaceTogglePlayback(event.target, containerRef.current)) {
            return false;
          }
          video.togglePlay();
          return true;
        },
        ArrowLeft: () => {
          video?.seekBy(-SEEK_STEP_SECONDS);
          return Boolean(video);
        },
        ArrowRight: () => {
          video?.seekBy(SEEK_STEP_SECONDS);
          return Boolean(video);
        },
      };

      const shortcut =
        shortcuts[normalizeShortcutKey(resolveMediaKey(event.key))];
      if (shortcut?.()) event.preventDefault();
    };

    window.addEventListener("keydown", onKeyDown);

    return () => {
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [lightbox, mediaItems, selectedIndex, openLightbox]);

  if (!hasScreenshots) {
    return null;
  }

  const renderVideoPlayer = (item: GalleryMediaItem, index: number) => {
    const borrowed =
      lightbox !== null &&
      (item.id === viewerItemId ||
        !!presentation?.borrowedVideoIds.includes(item.id));
    const active = borrowed && presentation?.activeVideoId === item.id;

    return (
      <GalleryVideoPlayer
        ref={(handle) => {
          if (handle) {
            playerHandlesRef.current.set(item.id, handle);
          } else {
            playerHandlesRef.current.delete(item.id);
          }
        }}
        variant={borrowed ? "viewer" : "inline"}
        className={borrowed ? "gallery-lightbox__frame" : undefined}
        item={item}
        autoPlay={autoplayEnabled && index === firstVideoIndex}
        loadOnDemand={!autoplayEnabled}
        isFullscreen={borrowed && !!presentation?.isFullscreen}
        controlsHidden={borrowed && !!presentation?.chromeHidden}
        onHoldChromeChange={active ? setVideoHoldsChrome : undefined}
        onToggleFullscreen={() => {
          if (borrowed) {
            toggleViewerFullscreenRef.current?.();
          } else {
            openLightbox(index, true);
          }
        }}
      />
    );
  };

  return (
    <div className="gallery-slider__container" ref={containerRef}>
      <div className="gallery-slider__viewport" ref={emblaRef}>
        <div className="gallery-slider__container-inner">
          {mediaItems.map((item, index) => (
            <div key={item.id} className="gallery-slider__slide">
              {item.type === "video" && videoHosts.has(item.id) ? (
                <>
                  <GalleryVideoSlot
                    host={videoHosts.get(item.id)!}
                    mode="home"
                  />
                  {createPortal(
                    renderVideoPlayer(item, index),
                    videoHosts.get(item.id)!.container
                  )}
                </>
              ) : (
                <div className="gallery-slider__image-slide">
                  <button
                    type="button"
                    className="gallery-slider__media-button"
                    onClick={() => openLightbox(index, false)}
                    aria-label={item.alt}
                  >
                    <img
                      className="gallery-slider__media"
                      src={item.src}
                      alt={item.alt}
                      loading="lazy"
                    />
                  </button>
                  <button
                    type="button"
                    className="gallery-slider__fullscreen-button"
                    onClick={() => openLightbox(index, true)}
                    aria-label={t("fullscreen")}
                    data-tooltip-id={GALLERY_PAGE_TOOLTIP_ID}
                    data-tooltip-content={`${t("fullscreen")} (F)`}
                    data-tooltip-place="top"
                  >
                    <CornersOut size={24} weight="bold" />
                  </button>
                </div>
              )}
            </div>
          ))}
        </div>

        <button
          onClick={scrollPrev}
          type="button"
          className="gallery-slider__button gallery-slider__button--left"
          aria-label={t("previous_screenshot")}
          tabIndex={0}
        >
          <ChevronLeftIcon size={36} />
        </button>

        <button
          onClick={scrollNext}
          type="button"
          className="gallery-slider__button gallery-slider__button--right"
          aria-label={t("next_screenshot")}
          tabIndex={0}
        >
          <ChevronRightIcon size={36} />
        </button>
      </div>

      <div
        className={cn("gallery-slider__preview", {
          "gallery-slider__preview--dragging": previewDrag.dragging,
        })}
        {...previewDrag.handlers}
      >
        {previews.map((media, i) => (
          <button
            key={media.id}
            type="button"
            className={`gallery-slider__preview-button ${
              selectedIndex === i
                ? "gallery-slider__preview-button--active"
                : ""
            }`}
            onClick={(e) => scrollToPreview(i, e)}
            aria-label={t("open_screenshot", { number: String(i + 1) })}
          >
            <img
              src={media.thumbnail}
              className="gallery-slider__preview-image"
              draggable={false}
              alt={t("screenshot", { number: String(i + 1) })}
            />
            {media.type === "video" && (
              <div className="gallery-slider__play-overlay">
                <Play size={18} weight="fill" />
              </div>
            )}
          </button>
        ))}
      </div>

      {createPortal(
        <Tooltip
          id={GALLERY_PAGE_TOOLTIP_ID}
          positionStrategy="fixed"
          style={{ zIndex: 9999 }}
        />,
        document.body
      )}

      <GalleryLightbox
        visible={lightbox !== null}
        autoplay={autoplayEnabled}
        items={mediaItems}
        index={lightbox?.index ?? 0}
        fullscreen={lightbox?.fullscreen}
        initialChromeHidden={lightbox?.chromeHidden}
        videoHosts={videoHosts}
        videoHoldsChrome={videoHoldsChrome}
        toggleFullscreenRef={toggleViewerFullscreenRef}
        getVideoHandle={getVideoHandle}
        onPresentationChange={setPresentation}
        onClose={closeLightbox}
        onNavigate={navigateLightbox}
      />
    </div>
  );
}
