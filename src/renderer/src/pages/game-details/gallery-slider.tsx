import { useEffect, useMemo, useRef, useState } from "react";
import { ChevronRightIcon, ChevronLeftIcon } from "@primer/octicons-react";

import type { ShopDetails } from "@types";

import * as styles from "./gallery-slider.css";
import { useTranslation } from "react-i18next";

export interface GallerySliderProps {
  gameDetails: ShopDetails;
}

export function GallerySlider({ gameDetails }: GallerySliderProps) {
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const mediaContainerRef = useRef<HTMLDivElement>(null);

  const { t } = useTranslation("game_details");

  const hasScreenshots = gameDetails && gameDetails.screenshots.length;
  const hasMovies = gameDetails && gameDetails.movies?.length;

  const [mediaCount] = useState<number>(() => {
    if (gameDetails.screenshots && gameDetails.movies) {
      return gameDetails.screenshots.length + gameDetails.movies.length;
    } else if (gameDetails.movies) {
      return gameDetails.movies.length;
    } else if (gameDetails.screenshots) {
      return gameDetails.screenshots.length;
    }

    return 0;
  });

  const [mediaIndex, setMediaIndex] = useState<number>(0);
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
  }, [gameDetails]);

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
  }, [gameDetails, mediaIndex, mediaCount]);

  const previews = useMemo(() => {
    const screenshotPreviews =
      gameDetails?.screenshots.map(({ id, path_thumbnail }) => ({
        id,
        thumbnail: path_thumbnail,
      })) ?? [];

    if (gameDetails?.movies) {
      const moviePreviews = gameDetails.movies.map(({ id, thumbnail }) => ({
        id,
        thumbnail,
      }));

      return [...moviePreviews, ...screenshotPreviews];
    }

    return screenshotPreviews;
  }, [gameDetails]);

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
            {gameDetails.movies &&
              gameDetails.movies.map((video) => (
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
              gameDetails.screenshots.map((image, i) => (
                <img
                  key={image.id}
                  className={styles.gallerySliderMedia}
                  src={image.path_full}
                  style={{ translate: `${-100 * mediaIndex}%` }}
                  alt={t("screenshot", { number: i + 1 })}
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
              tabIndex={0}
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
              tabIndex={0}
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
