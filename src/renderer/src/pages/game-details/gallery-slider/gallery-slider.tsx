import { useContext, useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { ChevronRightIcon, ChevronLeftIcon } from "@primer/octicons-react";

import * as styles from "./gallery-slider.css";
import { gameDetailsContext } from "@renderer/context";

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
        <div className={styles.gallerySliderContainer}>
          <div
            onMouseEnter={() => setShowArrows(true)}
            onMouseLeave={() => setShowArrows(false)}
            className={styles.gallerySliderAnimationContainer}
            ref={mediaContainerRef}
          >
            {shopDetails.movies &&
              shopDetails.movies.map((video) => (
                <video
                  key={video.id}
                  controls
                  className={styles.gallerySliderMedia}
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
                  className={styles.gallerySliderMedia}
                  src={image.path_full}
                  style={{ translate: `${-100 * mediaIndex}%` }}
                  alt={t("screenshot", { number: i + 1 })}
                  loading="lazy"
                />
              ))}

            <button
              onClick={showPrevImage}
              type="button"
              className={styles.gallerySliderButton({
                visible: showArrows,
                direction: "left",
              })}
              aria-label={t("previous_screenshot")}
              tabIndex={-1}
            >
              <ChevronLeftIcon size={36} />
            </button>

            <button
              onClick={showNextImage}
              type="button"
              className={styles.gallerySliderButton({
                visible: showArrows,
                direction: "right",
              })}
              aria-label={t("next_screenshot")}
              tabIndex={-1}
            >
              <ChevronRightIcon size={36} />
            </button>
          </div>

          <div className={styles.gallerySliderPreview} ref={scrollContainerRef}>
            {previews.map((media, i) => (
              <button
                key={media.id}
                type="button"
                className={styles.mediaPreviewButton({
                  active: mediaIndex === i,
                })}
                onClick={() => setMediaIndex(i)}
                aria-label={t("open_screenshot", { number: i + 1 })}
                onFocus={() => setMediaIndex(i)}
              >
                <img
                  src={media.thumbnail}
                  className={styles.mediaPreview}
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
