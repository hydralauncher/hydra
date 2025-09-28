import { useContext, useCallback, useMemo, useState, useEffect } from "react";
import { useTranslation } from "react-i18next";
import {
  ChevronRightIcon,
  ChevronLeftIcon,
  PlayIcon,
} from "@primer/octicons-react";
import useEmblaCarousel from "embla-carousel-react";
import { gameDetailsContext } from "@renderer/context";
import "./gallery-slider.scss";

export function GallerySlider() {
  const { shopDetails } = useContext(gameDetailsContext);
  const { t } = useTranslation("game_details");

  const hasScreenshots = shopDetails && shopDetails.screenshots?.length;

  const [emblaRef, emblaApi] = useEmblaCarousel({ loop: false });
  const [selectedIndex, setSelectedIndex] = useState(0);

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

    let isInitialLoad = true;

    const onSelect = () => {
      const newIndex = emblaApi.selectedScrollSnap();
      setSelectedIndex(newIndex);

      if (!isInitialLoad) {
        const videos = document.querySelectorAll(".gallery-slider__media");
        videos.forEach((video) => {
          if (video instanceof HTMLVideoElement) {
            video.pause();
          }
        });
      }

      isInitialLoad = false;
    };

    emblaApi.on("select", onSelect);
    onSelect();

    return () => {
      emblaApi.off("select", onSelect);
    };
  }, [emblaApi]);

  const mediaItems = useMemo(() => {
    const items: Array<{
      id: string;
      type: "video" | "image";
      src?: string;
      poster?: string;
      videoSrc?: string;
      alt: string;
    }> = [];

    if (shopDetails?.movies) {
      shopDetails.movies.forEach((video, index) => {
        items.push({
          id: String(video.id),
          type: "video",
          poster: video.thumbnail,
          videoSrc: video.mp4.max.startsWith("http://")
            ? video.mp4.max.replace("http://", "https://")
            : video.mp4.max,
          alt: t("video", { number: String(index + 1) }),
        });
      });
    }

    if (shopDetails?.screenshots) {
      shopDetails.screenshots.forEach((image, index) => {
        items.push({
          id: String(image.id),
          type: "image",
          src: image.path_full,
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

  if (!hasScreenshots) {
    return null;
  }

  return (
    <div className="gallery-slider__container">
      <div className="gallery-slider__viewport" ref={emblaRef}>
        <div className="gallery-slider__container-inner">
          {mediaItems.map((item) => (
            <div key={item.id} className="gallery-slider__slide">
              {item.type === "video" ? (
                <video
                  controls
                  className="gallery-slider__media"
                  poster={item.poster}
                  loop
                  muted
                  autoPlay
                  tabIndex={-1}
                >
                  <source src={item.videoSrc} />
                </video>
              ) : (
                <img
                  className="gallery-slider__media"
                  src={item.src}
                  alt={item.alt}
                  loading="lazy"
                />
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

      <div className="gallery-slider__preview">
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
              alt={t("screenshot", { number: String(i + 1) })}
            />
            {media.type === "video" && (
              <div className="gallery-slider__play-overlay">
                <PlayIcon size={20} />
              </div>
            )}
          </button>
        ))}
      </div>
    </div>
  );
}
