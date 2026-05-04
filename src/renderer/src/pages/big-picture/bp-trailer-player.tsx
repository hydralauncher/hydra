import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useTranslation } from "react-i18next";
import { useHlsVideo } from "@renderer/hooks/use-hls-video";
import { useBigPictureContext, type ViewerAction } from "./big-picture-app";
import type { ShopDetailsWithAssets } from "@types";
import "./bp-trailer-player.scss";

interface BpTrailerPlayerProps {
  shopDetails: ShopDetailsWithAssets;
  isViewerOpen: boolean;
  onOpenViewer: () => void;
  onCloseViewer: () => void;
}

interface TrailerSource {
  src: string;
  type: string;
  poster?: string;
  name?: string;
}

function formatTime(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${s.toString().padStart(2, "0")}`;
}

export function BpTrailerPlayer({
  shopDetails,
  isViewerOpen,
  onOpenViewer,
  onCloseViewer,
}: Readonly<BpTrailerPlayerProps>) {
  const { t } = useTranslation("big_picture");
  const { registerViewerHandler, unregisterViewerHandler } =
    useBigPictureContext();

  const videoRef = useRef<HTMLVideoElement>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [showControls, setShowControls] = useState(true);
  const controlsTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Stable refs for callbacks so the viewer handler effect doesn't re-run every render
  const onCloseViewerRef = useRef(onCloseViewer);
  onCloseViewerRef.current = onCloseViewer;

  const trailer = useMemo<TrailerSource | null>(() => {
    if (!shopDetails.movies || shopDetails.movies.length === 0) return null;

    const movie = shopDetails.movies[0];
    let src: string | undefined;
    let type = "video/mp4";

    if (movie.hls_h264) {
      src = movie.hls_h264;
      type = "application/x-mpegURL";
    } else if (movie.mp4?.max) {
      src = movie.mp4.max;
      type = "video/mp4";
    } else if (movie.webm?.max) {
      src = movie.webm.max;
      type = "video/webm";
    } else if (movie.mp4?.["480"]) {
      src = movie.mp4["480"];
      type = "video/mp4";
    } else if (movie.webm?.["480"]) {
      src = movie.webm["480"];
      type = "video/webm";
    }

    if (!src) return null;

    return {
      src: src.startsWith("http://") ? src.replace("http://", "https://") : src,
      type,
      poster: movie.thumbnail,
      name: movie.name,
    };
  }, [shopDetails]);

  const isHls = trailer?.type === "application/x-mpegURL";

  useHlsVideo(videoRef, {
    videoSrc: isViewerOpen ? trailer?.src : undefined,
    videoType: isViewerOpen ? trailer?.type : undefined,
    autoplay: true,
    muted: false,
    loop: false,
  });

  const resetControlsTimer = useCallback(() => {
    setShowControls(true);
    if (controlsTimerRef.current) {
      clearTimeout(controlsTimerRef.current);
    }
    controlsTimerRef.current = setTimeout(() => {
      if (videoRef.current && !videoRef.current.paused) {
        setShowControls(false);
      }
    }, 3000);
  }, []);

  // Set volume to 50% when viewer opens
  useEffect(() => {
    if (isViewerOpen && videoRef.current) {
      videoRef.current.volume = 0.5;
    }
  }, [isViewerOpen]);

  // Auto-play when viewer opens, reset when it closes
  useEffect(() => {
    if (isViewerOpen) {
      // For non-HLS, auto-play after the source is set
      if (!isHls && videoRef.current) {
        videoRef.current
          .play()
          .then(() => {
            setIsPlaying(true);
            resetControlsTimer();
          })
          .catch(() => {
            // Autoplay blocked, user can press A to play
            setIsPlaying(false);
          });
      } else {
        // HLS auto-play is handled by useHlsVideo hook
        setIsPlaying(true);
        resetControlsTimer();
      }
    } else {
      if (videoRef.current) {
        videoRef.current.pause();
        videoRef.current.currentTime = 0;
      }
      setIsPlaying(false);
      setCurrentTime(0);
      setDuration(0);
      setShowControls(true);
    }
  }, [isViewerOpen, isHls, resetControlsTimer]);

  // Register viewer handler: intercepts all gamepad/keyboard input while viewer is open
  // Left/Right = seek, A = play/pause, B = close
  useEffect(() => {
    if (!isViewerOpen) {
      return;
    }

    const handler = (action: ViewerAction) => {
      switch (action.type) {
        case "navigate":
          if (!videoRef.current) break;
          if (action.direction === "left") {
            videoRef.current.currentTime = Math.max(
              0,
              videoRef.current.currentTime - 10
            );
          } else if (action.direction === "right") {
            videoRef.current.currentTime = Math.min(
              videoRef.current.duration || 0,
              videoRef.current.currentTime + 10
            );
          }
          resetControlsTimer();
          break;
        case "select":
          if (!videoRef.current) break;
          if (videoRef.current.paused) {
            videoRef.current.play();
            setIsPlaying(true);
            resetControlsTimer();
          } else {
            videoRef.current.pause();
            setIsPlaying(false);
            setShowControls(true);
          }
          break;
        case "back":
          onCloseViewerRef.current();
          break;
      }
    };

    registerViewerHandler(handler);
    return () => unregisterViewerHandler();
  }, [
    isViewerOpen,
    resetControlsTimer,
    registerViewerHandler,
    unregisterViewerHandler,
  ]);

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
    setShowControls(true);
  }, []);

  const progressPercent = duration > 0 ? (currentTime / duration) * 100 : 0;

  useEffect(() => {
    return () => {
      if (controlsTimerRef.current) {
        clearTimeout(controlsTimerRef.current);
      }
    };
  }, []);

  if (!trailer) return null;

  return (
    <div className="bp-trailer-player">
      <h2 className="bp-trailer-player__title">{t("trailer")}</h2>

      {/* Thumbnail preview – click to open fullscreen viewer */}
      <button
        type="button"
        className="bp-trailer-player__preview"
        data-bp-focusable={!isViewerOpen ? "" : undefined}
        onClick={onOpenViewer}
      >
        <img
          src={trailer.poster}
          alt={trailer.name || t("trailer")}
          className="bp-trailer-player__preview-image"
          loading="lazy"
        />
        <div className="bp-trailer-player__preview-play">
          <span className="bp-trailer-player__preview-play-icon">&#9654;</span>
        </div>
        <span className="bp-trailer-player__preview-label">
          {t("trailer_play")}
        </span>
      </button>

      {/* Fullscreen viewer overlay — portalled to body to escape ancestor transforms */}
      {isViewerOpen &&
        createPortal(
          <div className="bp-trailer-viewer">
            <div className="bp-trailer-viewer__backdrop" />

            <div className="bp-trailer-viewer__content">
              {/* eslint-disable-next-line jsx-a11y/media-has-caption -- game trailers don't have caption tracks */}
              {isHls ? (
                <video
                  ref={videoRef}
                  className="bp-trailer-viewer__video"
                  poster={trailer.poster}
                  playsInline
                  onTimeUpdate={handleTimeUpdate}
                  onLoadedMetadata={handleLoadedMetadata}
                  onEnded={handleVideoEnded}
                >
                  <track kind="captions" />
                </video>
              ) : (
                <video
                  ref={videoRef}
                  className="bp-trailer-viewer__video"
                  poster={trailer.poster}
                  playsInline
                  onTimeUpdate={handleTimeUpdate}
                  onLoadedMetadata={handleLoadedMetadata}
                  onEnded={handleVideoEnded}
                >
                  <source src={trailer.src} type={trailer.type} />
                  <track kind="captions" />
                </video>
              )}

              {/* Pause indicator */}
              {!isPlaying && (
                <div className="bp-trailer-viewer__pause-indicator">
                  <span>&#9654;</span>
                </div>
              )}
            </div>

            {/* Progress bar – auto-hides during playback */}
            <div
              className={`bp-trailer-viewer__controls ${
                showControls || !isPlaying
                  ? "bp-trailer-viewer__controls--visible"
                  : ""
              }`}
            >
              <div className="bp-trailer-viewer__progress-row">
                <span className="bp-trailer-viewer__time">
                  {formatTime(currentTime)}
                </span>
                <div className="bp-trailer-viewer__progress-bar">
                  <div
                    className="bp-trailer-viewer__progress-fill"
                    style={{ width: `${progressPercent}%` }}
                  />
                </div>
                <span className="bp-trailer-viewer__time">
                  {formatTime(duration)}
                </span>
              </div>
            </div>
          </div>,
          document.body
        )}
    </div>
  );
}
