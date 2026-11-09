import { CaretLeftIcon, CaretRightIcon, PlayIcon } from "@phosphor-icons/react";
import { createPortal } from "react-dom";
import {
  GalleryVideoHost,
  GalleryVideoSlot,
} from "@renderer/pages/game-details/gallery-slider/gallery-video-host";
import {
  GalleryVideoPlayer,
  type GalleryPlaybackState,
  type GalleryVideoPlayerHandle,
} from "@renderer/pages/game-details/gallery-slider/gallery-video-player";
import type { GalleryMediaItem } from "@renderer/pages/game-details/gallery-slider/gallery-slider";
import { getSteamMovieSource } from "@renderer/pages/game-details/gallery-slider/gallery-media-sources";
import {
  isDialogOpen,
  isEditableTarget,
} from "@renderer/pages/game-details/gallery-slider/gallery-shortcuts";
import type { SteamMovie, SteamScreenshot } from "@types";
import useEmblaCarousel from "embla-carousel-react";
import type { FocusOverrideTarget } from "../../../../services";
import {
  type CSSProperties,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { useTranslation } from "react-i18next";
import { getItemFocusTarget } from "../../../../helpers";
import { useUserPreferences } from "../../../../hooks";
import { BIG_PICTURE_SIDEBAR_ITEM_IDS } from "../../../../layout";
import { FocusItem, HorizontalFocusGroup } from "../../../common";
import { useNavigationIsFocused, useNavigationStore } from "../../../../stores";
import {
  NavigationAudioService,
  NavigationService,
} from "../../../../services";
import {
  GAME_HERO_ACTIONS_REGION_ID,
  GAME_MEDIA_CAROUSEL_REGION_ID,
  getGameMediaCarouselItemId,
} from "../navigation";
import {
  MEDIA_VIEWER_IDLE_TIMEOUT_MS,
  MEDIA_VIEWER_INDICATOR_TIMEOUT_MS,
  MediaViewer,
  type MediaViewerPresentation,
} from "../media-viewer";

const PLAY_ICON_SIZE = 28;

interface ScreenshotCarouselProps {
  screenshots: SteamScreenshot[];
  videos: SteamMovie[];
  onActiveItemChange?: (itemId: string | null) => void;
  nextContentEntryTarget?: FocusOverrideTarget;
  sidebarEntryTarget?: FocusOverrideTarget;
}

type MediaItem = GalleryMediaItem & {
  focusId: string;
};

interface ScreenshotCarouselSlideProps {
  item: MediaItem;
  index: number;
  autoplayEnabled: boolean;
  preferencesLoaded: boolean;
  videoHost?: GalleryVideoHost;
  onFocused: (index: number) => void;
  onSelectItem: (index: number) => void;
  leftNavigationTarget?: FocusOverrideTarget;
  downNavigationTarget?: FocusOverrideTarget;
  rightNavigationTarget?: FocusOverrideTarget;
}

function ScreenshotCarouselSlide({
  item,
  index,
  autoplayEnabled,
  preferencesLoaded,
  videoHost,
  onFocused,
  onSelectItem,
  leftNavigationTarget,
  downNavigationTarget,
  rightNavigationTarget,
}: Readonly<ScreenshotCarouselSlideProps>) {
  const isFocused = useNavigationIsFocused(item.focusId);
  const surfaceRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    const surface = surfaceRef.current;
    if (!surface) return undefined;

    const onClick = () => onSelectItem(index);
    surface.addEventListener("click", onClick);

    return () => surface.removeEventListener("click", onClick);
  }, [index, onSelectItem]);

  useEffect(() => {
    if (!isFocused) return;
    onFocused(index);
  }, [index, isFocused, onFocused]);

  return (
    <article className="game-page__media-carousel-slide">
      <FocusItem
        id={item.focusId}
        navigationOverrides={{
          left: leftNavigationTarget,
          right: rightNavigationTarget,
          up: {
            type: "region",
            regionId: GAME_HERO_ACTIONS_REGION_ID,
            preferRememberedFocus: true,
          },
          down: downNavigationTarget ?? { type: "block" },
        }}
        asChild
      >
        <button
          ref={surfaceRef}
          type="button"
          className="game-page__media-carousel-surface"
          aria-label={`Media item ${index + 1}`}
        >
          {item.type === "video" ? (
            <>
              {videoHost && <GalleryVideoSlot host={videoHost} mode="home" />}

              {preferencesLoaded && !autoplayEnabled && (
                <div className="game-page__media-carousel-play-overlay">
                  <div className="game-page__media-carousel-play-icon">
                    <PlayIcon size={PLAY_ICON_SIZE} weight="fill" />
                  </div>
                </div>
              )}
            </>
          ) : (
            <img
              src={item.src}
              alt={item.alt}
              loading="lazy"
              className="game-page__media-carousel-image"
            />
          )}
        </button>
      </FocusItem>
    </article>
  );
}

export function ScreenshotCarousel({
  screenshots,
  videos,
  onActiveItemChange,
  nextContentEntryTarget,
  sidebarEntryTarget,
}: Readonly<ScreenshotCarouselProps>) {
  const [emblaRef, emblaApi] = useEmblaCarousel({ loop: false });
  const { t } = useTranslation("game_details");
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [viewerIndex, setViewerIndex] = useState<number | null>(null);
  const [presentation, setPresentation] =
    useState<MediaViewerPresentation | null>(null);
  const [videoHoldsChrome, setVideoHoldsChrome] = useState(true);
  const carouselContainerRef = useRef<HTMLDivElement | null>(null);
  const playerHandlesRef = useRef(new Map<string, GalleryVideoPlayerHandle>());
  const videoHostsRef = useRef(new Map<string, GalleryVideoHost>());
  const isFocusDrivenScrollRef = useRef(false);
  const navigation = NavigationService.getInstance();
  const currentFocusId = useNavigationStore((state) => state.currentFocusId);
  const userPreferences = useUserPreferences();
  const preferencesLoaded = userPreferences != null;
  const autoplayEnabled = preferencesLoaded
    ? userPreferences.autoplayGameTrailers !== false
    : false;

  const mediaItems: MediaItem[] = useMemo(() => {
    const items: MediaItem[] = [];

    videos.forEach((video, videoIndex) => {
      const movieSource = getSteamMovieSource(video);
      if (!movieSource) return;

      items.push({
        id: `video-${video.id}`,
        focusId: getGameMediaCarouselItemId(items.length),
        type: "video",
        poster: video.thumbnail,
        thumbnail: video.thumbnail,
        ...movieSource,
        alt: video.name || t("video", { number: String(videoIndex + 1) }),
      });
    });

    screenshots.forEach((image, imageIndex) => {
      items.push({
        id: `screenshot-${image.id}`,
        focusId: getGameMediaCarouselItemId(items.length),
        type: "image",
        src: image.path_full,
        thumbnail: image.path_thumbnail,
        alt: t("screenshot", { number: String(imageIndex + 1) }),
      });
    });

    return items;
  }, [videos, screenshots, t]);

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

  const itemFocusIds = useMemo(
    () => mediaItems.map((item) => item.focusId),
    [mediaItems]
  );
  const dotsStyle = useMemo(() => {
    if (mediaItems.length > 48) {
      return {
        "--media-carousel-dot-size": "4px",
        "--media-carousel-dot-active-width": "10px",
        "--media-carousel-dot-gap": "3px",
      } as CSSProperties;
    }

    if (mediaItems.length > 32) {
      return {
        "--media-carousel-dot-size": "6px",
        "--media-carousel-dot-active-width": "14px",
        "--media-carousel-dot-gap": "4px",
      } as CSSProperties;
    }

    if (mediaItems.length > 20) {
      return {
        "--media-carousel-dot-size": "8px",
        "--media-carousel-dot-active-width": "18px",
        "--media-carousel-dot-gap": "6px",
      } as CSSProperties;
    }

    return {
      "--media-carousel-dot-size": "10px",
      "--media-carousel-dot-active-width": "24px",
      "--media-carousel-dot-gap": "8px",
    } as CSSProperties;
  }, [mediaItems.length]);

  const scrollIntoView = useCallback(() => {
    carouselContainerRef.current?.scrollIntoView({
      behavior: "smooth",
      block: "center",
    });
  }, []);

  const isFocusInsideCarousel =
    currentFocusId != null && itemFocusIds.includes(currentFocusId);

  const onSelect = useCallback(() => {
    if (!emblaApi) return;

    const index = emblaApi.selectedScrollSnap();
    setSelectedIndex(index);

    if (
      !isFocusDrivenScrollRef.current &&
      isFocusInsideCarousel &&
      itemFocusIds[index] &&
      itemFocusIds[index] !== currentFocusId
    ) {
      navigation.setFocus(itemFocusIds[index]);
    }

    isFocusDrivenScrollRef.current = false;
  }, [
    currentFocusId,
    emblaApi,
    isFocusInsideCarousel,
    itemFocusIds,
    navigation,
  ]);

  useEffect(() => {
    if (!emblaApi) return;

    emblaApi.on("select", onSelect);
    onSelect();

    return () => {
      emblaApi.off("select", onSelect);
    };
  }, [emblaApi, onSelect]);

  const viewerOpenRef = useRef(false);
  viewerOpenRef.current = viewerIndex !== null;

  useEffect(() => {
    if (!emblaApi) return undefined;

    const syncPlayback = () => {
      if (viewerOpenRef.current) return;
      const index = emblaApi.selectedScrollSnap();

      mediaItems.forEach((item, itemIndex) => {
        if (item.type !== "video") return;
        const handle = playerHandlesRef.current.get(item.id);
        if (!handle) return;

        if (itemIndex === index && autoplayEnabled) {
          handle.play();
        } else {
          handle.pause();
        }
      });
    };

    emblaApi.on("select", syncPlayback);
    syncPlayback();

    return () => {
      emblaApi.off("select", syncPlayback);
    };
  }, [autoplayEnabled, emblaApi, mediaItems]);

  useEffect(() => {
    if (selectedIndex < mediaItems.length) return;
    setSelectedIndex(0);
  }, [mediaItems.length, selectedIndex]);

  useEffect(() => {
    if (!emblaApi || !currentFocusId) return;

    const focusedIndex = itemFocusIds.indexOf(currentFocusId);

    if (focusedIndex === -1) return;

    if (emblaApi.selectedScrollSnap() !== focusedIndex) {
      emblaApi.scrollTo(focusedIndex);
      return;
    }

    if (selectedIndex !== focusedIndex) {
      setSelectedIndex(focusedIndex);
    }
  }, [currentFocusId, emblaApi, itemFocusIds, selectedIndex]);

  useEffect(() => {
    onActiveItemChange?.(itemFocusIds[selectedIndex] ?? null);
  }, [itemFocusIds, onActiveItemChange, selectedIndex]);

  const handleSlideFocused = useCallback(
    (index: number) => {
      isFocusDrivenScrollRef.current = true;
      setSelectedIndex(index);
      emblaApi?.scrollTo(index);
      scrollIntoView();
    },
    [emblaApi, scrollIntoView]
  );

  const handleSelectItem = useCallback(
    (index: number, startPlayback = true) => {
      emblaApi?.scrollTo(index);
      const target = mediaItems[index];

      mediaItems.forEach((item) => {
        if (item.type === "video" && item.id !== target?.id) {
          playerHandlesRef.current.get(item.id)?.pause();
        }
      });

      if (startPlayback && target?.type === "video") {
        const handle = playerHandlesRef.current.get(target.id);
        const state = handle?.getState();
        if (state && !state.playing) handle?.play();
      }

      setVideoHoldsChrome(true);
      setViewerIndex(index);
    },
    [emblaApi, mediaItems]
  );

  const handleViewerClose = useCallback(
    (index: number) => {
      const closedItem = mediaItems[index];
      const handle =
        closedItem?.type === "video"
          ? playerHandlesRef.current.get(closedItem.id)
          : undefined;
      const playback: GalleryPlaybackState | null | undefined =
        handle?.getState();

      setViewerIndex(null);
      setPresentation(null);

      if (emblaApi && emblaApi.selectedScrollSnap() !== index) {
        emblaApi.scrollTo(index, true);
      }

      window.setTimeout(() => {
        if (closedItem) navigation.setFocus(closedItem.focusId);
        if (playback && handle) handle.restore(playback);
      }, 0);
    },
    [emblaApi, mediaItems, navigation]
  );

  const inViewRef = useRef(false);
  const focusIdRef = useRef(currentFocusId);
  focusIdRef.current = currentFocusId;

  useEffect(() => {
    if (viewerIndex !== null) return undefined;

    const onSpaceKeyDown = (event: KeyboardEvent) => {
      if (event.key !== " " || event.repeat) return;
      if (event.ctrlKey || event.metaKey || event.altKey || event.shiftKey) {
        return;
      }

      const focusedIndex = focusIdRef.current
        ? itemFocusIds.indexOf(focusIdRef.current)
        : -1;
      const item = mediaItems[focusedIndex];
      if (item?.type !== "video") return;

      event.preventDefault();
      event.stopImmediatePropagation();
      playerHandlesRef.current.get(item.id)?.togglePlay();
      NavigationAudioService.getInstance().play("select");
    };

    window.addEventListener("keydown", onSpaceKeyDown, true);

    return () => {
      window.removeEventListener("keydown", onSpaceKeyDown, true);
    };
  }, [itemFocusIds, mediaItems, viewerIndex]);

  useEffect(() => {
    const container = carouselContainerRef.current;
    if (!container) return undefined;

    const observer = new IntersectionObserver(([entry]) => {
      inViewRef.current = entry.isIntersecting;
    });
    observer.observe(container);

    return () => observer.disconnect();
  }, [mediaItems.length]);

  useEffect(() => {
    if (viewerIndex !== null) return undefined;

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.defaultPrevented || event.repeat) return;
      if (event.ctrlKey || event.metaKey || event.altKey || event.shiftKey) {
        return;
      }
      if (!inViewRef.current) return;

      if (isEditableTarget(event.target) || isDialogOpen()) return;

      const item = mediaItems[selectedIndex];
      if (!item) return;

      const key = event.key.toLowerCase();
      if (key === "f") {
        handleSelectItem(selectedIndex, false);
      } else if (key === "m" && item.type === "video") {
        playerHandlesRef.current.get(item.id)?.toggleMute();
      } else {
        return;
      }

      event.preventDefault();
    };

    window.addEventListener("keydown", onKeyDown);

    return () => {
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [handleSelectItem, mediaItems, selectedIndex, viewerIndex]);

  const scrollPrev = () => emblaApi?.scrollPrev();
  const scrollNext = () => emblaApi?.scrollNext();

  if (mediaItems.length === 0) {
    return null;
  }

  return (
    <div ref={carouselContainerRef} className="game-page__media-carousel">
      <div className="game-page__media-carousel-viewport" ref={emblaRef}>
        <HorizontalFocusGroup
          regionId={GAME_MEDIA_CAROUSEL_REGION_ID}
          className="game-page__media-carousel-container"
          asChild
        >
          <div>
            {mediaItems.map((item, index) => (
              <ScreenshotCarouselSlide
                key={item.id}
                item={item}
                index={index}
                autoplayEnabled={autoplayEnabled}
                preferencesLoaded={preferencesLoaded}
                videoHost={videoHosts.get(item.id)}
                onFocused={handleSlideFocused}
                onSelectItem={handleSelectItem}
                leftNavigationTarget={
                  index === 0
                    ? getItemFocusTarget(BIG_PICTURE_SIDEBAR_ITEM_IDS.home)
                    : getItemFocusTarget(mediaItems[index - 1].focusId)
                }
                downNavigationTarget={nextContentEntryTarget}
                rightNavigationTarget={
                  index === mediaItems.length - 1
                    ? (sidebarEntryTarget ?? { type: "block" })
                    : getItemFocusTarget(mediaItems[index + 1].focusId)
                }
              />
            ))}
          </div>
        </HorizontalFocusGroup>
      </div>

      <div className="game-page__media-carousel-controls">
        <button
          type="button"
          onClick={scrollPrev}
          onFocus={scrollIntoView}
          className="game-page__media-carousel-arrow"
          aria-label="Previous slide"
          tabIndex={-1}
        >
          <CaretLeftIcon size={24} color="#fff" />
        </button>

        <div className="game-page__media-carousel-dots" style={dotsStyle}>
          {mediaItems.map((item, index) => (
            <button
              key={`dot-${item.id}`}
              type="button"
              onClick={() => emblaApi?.scrollTo(index)}
              aria-label={`Go to slide ${index + 1}`}
              className="game-page__media-carousel-dot"
              data-active={index === selectedIndex || undefined}
              tabIndex={-1}
            />
          ))}
        </div>

        <button
          type="button"
          onClick={scrollNext}
          onFocus={scrollIntoView}
          className="game-page__media-carousel-arrow"
          aria-label="Next slide"
          tabIndex={-1}
        >
          <CaretRightIcon size={24} color="#fff" />
        </button>
      </div>

      {mediaItems.map((item, index) => {
        const host = videoHosts.get(item.id);
        if (item.type !== "video" || !host) return null;

        const viewerItemId =
          viewerIndex !== null ? mediaItems[viewerIndex]?.id : undefined;
        const borrowed =
          viewerIndex !== null &&
          (item.id === viewerItemId ||
            !!presentation?.borrowedVideoIds.includes(item.id));
        const active = borrowed && presentation?.activeVideoId === item.id;

        return createPortal(
          <GalleryVideoPlayer
            ref={(handle) => {
              if (handle) {
                playerHandlesRef.current.set(item.id, handle);
              } else {
                playerHandlesRef.current.delete(item.id);
              }
            }}
            variant={borrowed ? "viewer" : "inline"}
            className={borrowed ? "media-viewer__frame" : undefined}
            interactive={borrowed}
            item={item}
            autoPlay={autoplayEnabled && index === selectedIndex}
            loadOnDemand={!autoplayEnabled}
            isFullscreen={borrowed}
            idleTimeoutMs={borrowed ? MEDIA_VIEWER_IDLE_TIMEOUT_MS : undefined}
            indicatorTimeoutMs={
              borrowed ? MEDIA_VIEWER_INDICATOR_TIMEOUT_MS : undefined
            }
            controlsHidden={borrowed && !!presentation?.chromeHidden}
            onHoldChromeChange={active ? setVideoHoldsChrome : undefined}
            onToggleFullscreen={() => {
              if (viewerIndex !== null) handleViewerClose(viewerIndex);
            }}
          />,
          host.container,
          item.id
        );
      })}

      {viewerIndex !== null && (
        <MediaViewer
          items={mediaItems}
          index={viewerIndex}
          autoplay={autoplayEnabled}
          videoHosts={videoHosts}
          videoHoldsChrome={videoHoldsChrome}
          getVideoHandle={getVideoHandle}
          onPresentationChange={setPresentation}
          onNavigate={setViewerIndex}
          onClose={handleViewerClose}
        />
      )}
    </div>
  );
}
