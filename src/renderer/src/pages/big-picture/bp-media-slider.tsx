import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useTranslation } from "react-i18next";
import type { ShopDetailsWithAssets } from "@types";
import { useBigPictureContext, type ViewerAction } from "./big-picture-app";
import "./bp-media-slider.scss";

interface BpMediaSliderProps {
  shopDetails: ShopDetailsWithAssets;
  viewerIndex: number | null;
  onOpenViewer: (index: number) => void;
  onCloseViewer: () => void;
  disabled?: boolean;
}

interface MediaItem {
  id: string;
  type: "video" | "image";
  src?: string;
  poster?: string;
  videoSrc?: string;
  alt: string;
}

function formatTime(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${s.toString().padStart(2, "0")}`;
}

export function BpMediaSlider({
  shopDetails,
  viewerIndex,
  onOpenViewer,
  onCloseViewer,
  disabled = false,
}: Readonly<BpMediaSliderProps>) {
  const { t } = useTranslation("big_picture");
  const { registerViewerHandler, unregisterViewerHandler } =
    useBigPictureContext();

  // Stable refs for callbacks so the viewer handler effect doesn't re-run on every render
  const onOpenViewerRef = useRef(onOpenViewer);
  onOpenViewerRef.current = onOpenViewer;
  const onCloseViewerRef = useRef(onCloseViewer);
  onCloseViewerRef.current = onCloseViewer;

  // Video player state
  const videoRef = useRef<HTMLVideoElement>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);

  const viewerOpen = viewerIndex !== null;
  const itemsFocusable = !viewerOpen && !disabled;

  const mediaItems = useMemo<MediaItem[]>(() => {
    const items: MediaItem[] = [];

    if (shopDetails.movies) {
      shopDetails.movies.forEach((video, index) => {
        let videoSrc: string | undefined;

        if (video.mp4?.max) {
          videoSrc = video.mp4.max;
        } else if (video.webm?.max) {
          videoSrc = video.webm.max;
        } else if (video.mp4?.["480"]) {
          videoSrc = video.mp4["480"];
        } else if (video.webm?.["480"]) {
          videoSrc = video.webm["480"];
        }

        if (videoSrc) {
          items.push({
            id: String(video.id),
            type: "video",
            poster: video.thumbnail,
            videoSrc: videoSrc.startsWith("http://")
              ? videoSrc.replace("http://", "https://")
              : videoSrc,
            alt: video.name || t("media") + ` ${index + 1}`,
          });
        }
      });
    }

    if (shopDetails.screenshots) {
      shopDetails.screenshots.forEach((image, index) => {
        items.push({
          id: String(image.id),
          type: "image",
          src: image.path_full,
          alt: t("media") + ` ${index + 1}`,
        });
      });
    }

    return items;
  }, [shopDetails, t]);

  const currentViewerItem =
    viewerIndex !== null ? mediaItems[viewerIndex] : null;

  // --- Video player logic ---

  useEffect(() => {
    setIsPlaying(false);
    setCurrentTime(0);
    setDuration(0);
  }, [viewerIndex]);

  const handleTimeUpdate = useCallback(() => {
    if (videoRef.current) {
      setCurrentTime(videoRef.current.currentTime);
    }
  }, []);

  const handleLoadedMetadata = useCallback(() => {
    if (videoRef.current) {
      setDuration(videoRef.current.duration);
    }
  }, []);

  const handleVideoEnded = useCallback(() => {
    setIsPlaying(false);
  }, []);

  const handlePlayPause = useCallback(() => {
    if (!videoRef.current) return;
    if (videoRef.current.paused) {
      videoRef.current.play();
      setIsPlaying(true);
    } else {
      videoRef.current.pause();
      setIsPlaying(false);
    }
  }, []);

  const handleSeekBack = useCallback(() => {
    if (!videoRef.current) return;
    videoRef.current.currentTime = Math.max(
      0,
      videoRef.current.currentTime - 10
    );
  }, []);

  const handleSeekForward = useCallback(() => {
    if (!videoRef.current) return;
    videoRef.current.currentTime = Math.min(
      videoRef.current.duration || 0,
      videoRef.current.currentTime + 10
    );
  }, []);

  const handleViewerPrev = useCallback(() => {
    if (viewerIndex === null || viewerIndex <= 0) return;
    onOpenViewer(viewerIndex - 1);
  }, [viewerIndex, onOpenViewer]);

  const handleViewerNext = useCallback(() => {
    if (viewerIndex === null || viewerIndex >= mediaItems.length - 1) return;
    onOpenViewer(viewerIndex + 1);
  }, [viewerIndex, mediaItems.length, onOpenViewer]);

  // Stable refs for values used inside the viewer handler
  const viewerIndexRef = useRef(viewerIndex);
  viewerIndexRef.current = viewerIndex;
  const mediaItemsRef = useRef(mediaItems);
  mediaItemsRef.current = mediaItems;

  // Register viewer handler: intercepts all gamepad/keyboard input while viewer is open
  useEffect(() => {
    if (!viewerOpen) {
      return;
    }

    const handler = (action: ViewerAction) => {
      const idx = viewerIndexRef.current;
      const items = mediaItemsRef.current;

      switch (action.type) {
        case "navigate":
          if (action.direction === "left") {
            if (idx !== null && idx > 0) {
              onOpenViewerRef.current(idx - 1);
            }
          } else if (action.direction === "right") {
            if (idx !== null && idx < items.length - 1) {
              onOpenViewerRef.current(idx + 1);
            }
          }
          break;
        case "select":
          // Toggle play/pause for videos
          if (idx !== null && items[idx]?.type === "video") {
            if (videoRef.current) {
              if (videoRef.current.paused) {
                videoRef.current.play();
                setIsPlaying(true);
              } else {
                videoRef.current.pause();
                setIsPlaying(false);
              }
            }
          }
          break;
        case "back":
          onCloseViewerRef.current();
          break;
      }
    };

    registerViewerHandler(handler);
    return () => unregisterViewerHandler();
  }, [viewerOpen, registerViewerHandler, unregisterViewerHandler]);

  const progressPercent = duration > 0 ? (currentTime / duration) * 100 : 0;

  if (mediaItems.length === 0) return null;

  return (
    <div className="bp-media-slider">
      <div className="bp-media-slider__header">
        <h2 className="bp-media-slider__title">{t("media")}</h2>
        <span className="bp-media-slider__counter">
          {mediaItems.length} {t("media").toLowerCase()}
        </span>
      </div>

      {/* Bento grid */}
      <div className="bp-media-slider__bento">
        {mediaItems.map((item, i) => {
          const mod = i % 6;
          let sizeClass = "";
          if (mod === 0) sizeClass = "bp-media-slider__bento-item--large";
          else if (mod === 3) sizeClass = "bp-media-slider__bento-item--wide";
          else if (mod === 5) sizeClass = "bp-media-slider__bento-item--tall";

          return (
            <button
              key={item.id}
              type="button"
              className={`bp-media-slider__bento-item ${sizeClass}`}
              data-bp-focusable={itemsFocusable ? "" : undefined}
              onClick={() => onOpenViewer(i)}
            >
              <img
                src={item.type === "video" ? item.poster : item.src}
                alt={item.alt}
                className="bp-media-slider__bento-image"
                loading="lazy"
              />
              <div className="bp-media-slider__bento-overlay" />
              {item.type === "video" && (
                <div className="bp-media-slider__bento-play">&#9654;</div>
              )}
            </button>
          );
        })}
      </div>

      {/* Fullscreen viewer overlay — portalled to body to escape ancestor transforms */}
      {viewerOpen &&
        currentViewerItem &&
        createPortal(
          <div className="bp-media-viewer">
            <div className="bp-media-viewer__backdrop" />

            <div className="bp-media-viewer__content">
              {currentViewerItem.type === "video" ? (
                // eslint-disable-next-line jsx-a11y/media-has-caption -- game trailers don't have caption tracks
                <video
                  ref={videoRef}
                  className="bp-media-viewer__video"
                  src={currentViewerItem.videoSrc}
                  poster={currentViewerItem.poster}
                  onTimeUpdate={handleTimeUpdate}
                  onLoadedMetadata={handleLoadedMetadata}
                  onEnded={handleVideoEnded}
                  playsInline
                />
              ) : (
                <img
                  className="bp-media-viewer__image"
                  src={currentViewerItem.src}
                  alt={currentViewerItem.alt}
                />
              )}
            </div>

            <div className="bp-media-viewer__controls">
              <div className="bp-media-viewer__controls-row">
                <button
                  type="button"
                  className="bp-media-viewer__btn"
                  onClick={handleViewerPrev}
                  disabled={viewerIndex <= 0}
                >
                  &#9664; {t("viewer_prev")}
                </button>

                {currentViewerItem.type === "video" && (
                  <>
                    <button
                      type="button"
                      className="bp-media-viewer__btn"
                      onClick={handleSeekBack}
                    >
                      &#9194; 10s
                    </button>

                    <button
                      type="button"
                      className="bp-media-viewer__btn bp-media-viewer__btn--play"
                      onClick={handlePlayPause}
                    >
                      {isPlaying ? "\u23F8" : "\u25B6"}
                    </button>

                    <button
                      type="button"
                      className="bp-media-viewer__btn"
                      onClick={handleSeekForward}
                    >
                      10s &#9193;
                    </button>
                  </>
                )}

                <button
                  type="button"
                  className="bp-media-viewer__btn"
                  onClick={handleViewerNext}
                  disabled={viewerIndex >= mediaItems.length - 1}
                >
                  {t("viewer_next")} &#9654;
                </button>
              </div>

              {currentViewerItem.type === "video" && (
                <div className="bp-media-viewer__progress-row">
                  <span className="bp-media-viewer__time">
                    {formatTime(currentTime)}
                  </span>
                  <div className="bp-media-viewer__progress-bar">
                    <div
                      className="bp-media-viewer__progress-fill"
                      style={{ width: `${progressPercent}%` }}
                    />
                  </div>
                  <span className="bp-media-viewer__time">
                    {formatTime(duration)}
                  </span>
                </div>
              )}

              <div className="bp-media-viewer__counter">
                {(viewerIndex ?? 0) + 1} / {mediaItems.length}
              </div>
            </div>
          </div>,
          document.body
        )}
    </div>
  );
}
