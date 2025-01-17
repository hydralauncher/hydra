import { useContext, useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { ChevronRightIcon, ChevronLeftIcon } from "@primer/octicons-react";

import "./gallery-slider.scss"
import { gameDetailsContext } from "@renderer/context";

const getButtonClasses = (visible: boolean, direction: "left" | "right") => {
  return classNames("gallery-slider__button", {
    "gallery-slider__button--visible": visible,
    [`gallery-slider__button--${direction}`]: direction,
  });
};

const getPreviewClasses = (isActive: boolean) => {
  return classNames("gallery-slider__media-preview-button", {
    "gallery-slider__media-preview-button--active": isActive,
  });
};

export function GallerySlider() {
  const { shopDetails } = useContext(gameDetailsContext);

  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const mediaContainerRef = useRef<HTMLDivElement>(null);

  const { t } = useTranslation("game_details");

  const hasScreenshots = shopDetails && shopDetails.screenshots?.length;
  const hasMovies = shopDetails && shopDetails.movies?.length;

  const mediaCount = useMemo(() => {
    if (!shopDetails) return 0;

    if (shopDetails.screenshots && shopDetails.movies) {
      return shopDetails.screenshots.length + shopDetails.movies.length;
    } else if (shopDetails.movies) {
      return shopDetails.movies.length;
    } else if (shopDetails.screenshots) {
      return shopDetails.screenshots.length;
    }

    return 0;
  }, [shopDetails]);

  const [mediaIndex, setMediaIndex] = useState(0);
  const [showArrows, setShowArrows] = useState(false);

  const showNextImage = () => {
    setMediaIndex((index: number) => {
      if (index === mediaCount - 1) return 0;

      return index + 1;
    });
  };

  const showPrevImage = () => {
    setMediaIndex((index: number) => {
      if (index === 0) return mediaCount - 1;

      return index - 1;
    });
  };

  useEffect(() => {
    setMediaIndex(0);
  }, [shopDetails]);

  useEffect(() => {
    if (hasMovies && mediaContainerRef.current) {
      mediaContainerRef.current.childNodes.forEach((node, index) => {
        if (node instanceof HTMLVideoElement) {
          if (index !== mediaIndex) {
            node.pause();
          }
        }
      });
    }
  }, [hasMovies, mediaContainerRef, mediaIndex]);

  useEffect(() => {
    if (scrollContainerRef.current) {
      const container = scrollContainerRef.current;
      const totalWidth = container.scrollWidth - container.clientWidth;
      const itemWidth = totalWidth / (mediaCount - 1);
      const scrollLeft = mediaIndex * itemWidth;
      container.scrollLeft = scrollLeft;
    }
  }, [shopDetails, mediaIndex, mediaCount]);

  const previews = useMemo(() => {
    const screenshotPreviews =
      shopDetails?.screenshots?.map(({ id, path_thumbnail }) => ({
        id,
        thumbnail: path_thumbnail,
      })) ?? [];

    if (shopDetails?.movies) {
      const moviePreviews = shopDetails.movies.map(({ id, thumbnail }) => ({
        id,
        thumbnail,
      }));

      return [...moviePreviews, ...screenshotPreviews];
    }

    return screenshotPreviews;
  }, [shopDetails]);

  return (
    <>
      {hasScreenshots && (
        <div className="gallery-slider__container">
          <div
            onMouseEnter={() => setShowArrows(true)}
            onMouseLeave={() => setShowArrows(false)}
            className="gallery-slider__animation-container"
            ref={mediaContainerRef}
          >
            {shopDetails.movies &&
              shopDetails.movies.map((video) => (
                <video
                  key={video.id}
                  controls
                  className="gallery-slider__media"
                  poster={video.thumbnail}
                  style={{ translate: `${-100 * mediaIndex}%` }}
                  loop
                  muted
                  tabIndex={-1}
                >
                  <source src={video.mp4.max.replace("http", "https")} />
                </video>
              ))}

            {hasScreenshots &&
              shopDetails.screenshots?.map((image, i) => (
                <img
                  key={image.id}
                  className="gallery-slider__media"
                  src={image.path_full}
                  style={{ translate: `${-100 * mediaIndex}%` }}
                  alt={t("screenshot", { number: i + 1 })}
                  loading="lazy"
                />
              ))}

            <button
              onClick={showPrevImage}
              type="button"
              className={getButtonClasses(showArrows, "left")}
              aria-label={t("previous_screenshot")}
              tabIndex={0}
            >
              <ChevronLeftIcon size={36} />
            </button>

            <button
              onClick={showNextImage}
              type="button"
              className={getButtonClasses(showArrows, "right")}
              aria-label={t("next_screenshot")}
              tabIndex={0}
            >
              <ChevronRightIcon size={36} />
            </button>
          </div>

          <div className="gallery-slider__preview" ref={scrollContainerRef}>
            {previews.map((media, i) => (
              <button
                key={media.id}
                type="button"
                className={getPreviewClasses(mediaIndex === i)}
                onClick={() => setMediaIndex(i)}
                aria-label={t("open_screenshot", { number: i + 1 })}
              >
                <img
                  src={media.thumbnail}
                  className="gallery-slider__media-preview"
                  alt={t("screenshot", { number: i + 1 })}
                />
              </button>
            ))}
          </div>
        </div>
      )}
    </>
  );
}
