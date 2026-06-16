import { CaretLeftIcon, CaretRightIcon } from "@phosphor-icons/react";
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
import { getItemFocusTarget } from "../../../../helpers";
import { BIG_PICTURE_SIDEBAR_ITEM_IDS } from "../../../../layout";
import { FocusItem, HorizontalFocusGroup } from "../../../common";
import { useNavigationIsFocused, useNavigationStore } from "../../../../stores";
import { NavigationService } from "../../../../services";
import {
  GAME_HERO_ACTIONS_REGION_ID,
  GAME_MEDIA_CAROUSEL_REGION_ID,
  getGameMediaCarouselItemId,
} from "../navigation";
import { VideoPlayer } from "./video-player";

interface ScreenshotCarouselProps {
  screenshots: SteamScreenshot[];
  videos: SteamMovie[];
  onActiveItemChange?: (itemId: string | null) => void;
  nextContentEntryTarget?: FocusOverrideTarget;
  sidebarEntryTarget?: FocusOverrideTarget;
}

type MediaItem = {
  id: string;
  focusId: string;
  type: "video" | "image";
  src?: string;
  poster?: string;
  videoSrc?: string;
  videoType?: string;
};

interface ScreenshotCarouselSlideProps {
  item: MediaItem;
  index: number;
  isSelected: boolean;
  onFocused: (index: number) => void;
  onSelectItem: (index: number) => void;
  setVideoRef: (index: number, element: HTMLVideoElement | null) => void;
  leftNavigationTarget?: FocusOverrideTarget;
  downNavigationTarget?: FocusOverrideTarget;
  rightNavigationTarget?: FocusOverrideTarget;
}

function ScreenshotCarouselSlide({
  item,
  index,
  isSelected,
  onFocused,
  onSelectItem,
  setVideoRef,
  leftNavigationTarget,
  downNavigationTarget,
  rightNavigationTarget,
}: Readonly<ScreenshotCarouselSlideProps>) {
  const isFocused = useNavigationIsFocused(item.focusId);

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
          type="button"
          className="game-page__media-carousel-surface"
          onClick={() => onSelectItem(index)}
          aria-label={`Media item ${index + 1}`}
        >
          {item.type === "video" ? (
            <VideoPlayer
              videoSrc={item.videoSrc}
              videoType={item.videoType}
              poster={item.poster}
              autoplay={isSelected}
              muted
              loop
              controls
              style={{
                width: "100%",
                borderRadius: 8,
                objectFit: "cover",
                aspectRatio: "16 / 9",
              }}
              videoRef={(element) => {
                setVideoRef(index, element);
              }}
            />
          ) : (
            <img
              src={item.src}
              alt={`Screenshot ${index + 1}`}
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
  const [selectedIndex, setSelectedIndex] = useState(0);
  const carouselContainerRef = useRef<HTMLDivElement | null>(null);
  const videoRefs = useRef<Array<HTMLVideoElement | null>>([]);
  const isFocusDrivenScrollRef = useRef(false);
  const navigation = NavigationService.getInstance();
  const currentFocusId = useNavigationStore((state) => state.currentFocusId);

  const mediaItems: MediaItem[] = useMemo(() => {
    const items: MediaItem[] = [];

    videos.forEach((video) => {
      let videoSrc: string | undefined;
      let videoType: string | undefined;

      if (video.hls_h264) {
        videoSrc = video.hls_h264;
        videoType = "application/x-mpegURL";
      } else if (video.dash_h264) {
        videoSrc = video.dash_h264;
        videoType = "application/dash+xml";
      } else if (video.dash_av1) {
        videoSrc = video.dash_av1;
        videoType = "application/dash+xml";
      } else if (video.mp4?.max) {
        videoSrc = video.mp4.max;
        videoType = "video/mp4";
      } else if (video.webm?.max) {
        videoSrc = video.webm.max;
        videoType = "video/webm";
      }

      if (videoSrc) {
        items.push({
          id: `video-${video.id}`,
          focusId: getGameMediaCarouselItemId(items.length),
          type: "video",
          poster: video.thumbnail,
          videoSrc: videoSrc.startsWith("http://")
            ? videoSrc.replace("http://", "https://")
            : videoSrc,
          videoType,
        });
      }
    });

    screenshots.forEach((image) => {
      items.push({
        id: `screenshot-${image.id}`,
        focusId: getGameMediaCarouselItemId(items.length),
        type: "image",
        src: image.path_full,
      });
    });

    return items;
  }, [videos, screenshots]);

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

    videoRefs.current.forEach((video, videoIndex) => {
      if (!video) return;

      if (videoIndex === index) {
        video.play().catch(() => {});
      } else {
        video.pause();
      }
    });

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
    (index: number) => {
      emblaApi?.scrollTo(index);
    },
    [emblaApi]
  );

  const setVideoRef = useCallback(
    (index: number, element: HTMLVideoElement | null) => {
      videoRefs.current[index] = element;
    },
    []
  );

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
                isSelected={index === selectedIndex}
                onFocused={handleSlideFocused}
                onSelectItem={handleSelectItem}
                setVideoRef={setVideoRef}
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
    </div>
  );
}
