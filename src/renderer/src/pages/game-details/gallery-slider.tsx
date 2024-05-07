import { useEffect, useRef, useState } from "react";
import { ShopDetails, SteamMovies, SteamScreenshot } from "@types";
import { ChevronRightIcon, ChevronLeftIcon } from "@primer/octicons-react";
import * as styles from "./game-details.css";

export interface GallerySliderProps {
  gameDetails: ShopDetails | null;
}

export function GallerySlider({ gameDetails }: GallerySliderProps) {
  const scrollContainerRef = useRef<HTMLDivElement>(null);

  const [mediaCount] = useState<number>(() => {
    if (gameDetails) {
      if (gameDetails.screenshots && gameDetails.movies) {
        return gameDetails.screenshots.length + gameDetails.movies.length;
      } else if (gameDetails.movies) {
        return gameDetails.movies.length;
      } else if (gameDetails.screenshots) {
        return gameDetails.screenshots.length;
      }
    }
    return 0;
  });
  const [mediaIndex, setMediaIndex] = useState<number>(0);
  const [arrowShow, setArrowShow] = useState(false);

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
    if (scrollContainerRef.current) {
      const container = scrollContainerRef.current;
      const totalWidth = container.scrollWidth - container.clientWidth;
      const itemWidth = totalWidth / (mediaCount - 1);
      const scrollLeft = mediaIndex * itemWidth;
      container.scrollLeft = scrollLeft;
    }
  }, [mediaIndex, mediaCount]);

  const hasScreenshots = gameDetails && gameDetails.screenshots.length > 0;
  const hasMovies = gameDetails && gameDetails.movies.length > 0;

  return (
    <>
      {hasScreenshots && (
        <div className={styles.gallerySliderContainer}>
          <div
            onMouseEnter={() => setArrowShow(true)}
            onMouseLeave={() => setArrowShow(false)}
            className={styles.gallerySliderAnimationContainer}
          >
            {gameDetails.movies &&
              gameDetails.movies.map((video: SteamMovies) => (
                <video
                  key={video.id}
                  controls
                  className={styles.gallerySliderMedia}
                  poster={video.thumbnail}
                  style={{ translate: `${-100 * mediaIndex}%` }}
                  autoPlay
                  muted
                >
                  <source src={video.webm.max.replace("http", "https")} />
                </video>
              ))}

            {gameDetails.screenshots.map((image: SteamScreenshot) => (
              <img
                key={image.id}
                className={styles.gallerySliderMedia}
                src={image.path_full}
                style={{ translate: `${-100 * mediaIndex}%` }}
              />
            ))}

            {arrowShow && (
              <>
                <button
                  onClick={showPrevImage}
                  type="button"
                  className={styles.gallerySliderButton}
                  style={{ left: 0 }}
                >
                  <ChevronLeftIcon className={styles.gallerySliderIcons} />
                </button>

                <button
                  onClick={showNextImage}
                  type="button"
                  className={styles.gallerySliderButton}
                  style={{ right: 0 }}
                >
                  <ChevronRightIcon className={styles.gallerySliderIcons} />
                </button>
              </>
            )}
          </div>

          <div className={styles.gallerySliderPreview} ref={scrollContainerRef}>
            {hasMovies &&
              gameDetails.movies.map((video: SteamMovies, i: number) => (
                <img
                  key={video.id}
                  onClick={() => setMediaIndex(i)}
                  src={video.thumbnail}
                  className={`${styles.gallerySliderMediaPreview} ${mediaIndex === i ? styles.gallerySliderMediaPreviewActive : ""}`}
                />
              ))}

            {gameDetails.screenshots.map(
              (image: SteamScreenshot, i: number) => (
                <img
                  key={image.id}
                  onClick={() =>
                    setMediaIndex(
                      i + (gameDetails.movies ? gameDetails.movies.length : 0)
                    )
                  }
                  className={`${styles.gallerySliderMediaPreview} ${mediaIndex === i + (gameDetails.movies ? gameDetails.movies.length : 0) ? styles.gallerySliderMediaPreviewActive : ""}`}
                  src={image.path_full}
                />
              )
            )}
          </div>
        </div>
      )}
    </>
  );
}
