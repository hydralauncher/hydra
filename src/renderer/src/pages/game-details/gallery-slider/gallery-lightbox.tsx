import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal, flushSync } from "react-dom";
import cn from "classnames";
import { useTranslation } from "react-i18next";
import {
  XIcon,
  ChevronLeftIcon,
  ChevronRightIcon,
} from "@primer/octicons-react";
import { CornersIn, CornersOut, Play } from "@phosphor-icons/react";
import { Tooltip } from "react-tooltip";
import {
  FULLSCREEN_IDLE_TIMEOUT_MS,
  GALLERY_VIEWER_TOOLTIP_ID,
  VIEWER_IDLE_TIMEOUT_MS,
  SEEK_STEP_SECONDS,
  resolveMediaKey,
  type GalleryPlaybackState,
  type GalleryVideoPlayerHandle,
} from "./gallery-video-player";
import { GalleryVideoSlot, type GalleryVideoHost } from "./gallery-video-host";
import type { GalleryMediaItem } from "./gallery-slider";
import { useDragScroll } from "./use-drag-scroll";
import "./gallery-lightbox.scss";

const ESCAPE_AFTER_FULLSCREEN_EXIT_MS = 300;
const LAYER_FADE_MS = 280;
const VOLUME_STEP = 0.05;
const DEFAULT_ASPECT_RATIO = 16 / 9;

export interface GalleryViewerPresentation {
  isFullscreen: boolean;
  chromeHidden: boolean;
  activeVideoId: string | null;
  borrowedVideoIds: string[];
}

export interface GalleryLightboxProps {
  visible: boolean;
  items: GalleryMediaItem[];
  index: number;
  fullscreen?: boolean;
  autoplay?: boolean;
  videoHosts: Map<string, GalleryVideoHost>;
  videoHoldsChrome: boolean;
  toggleFullscreenRef: React.MutableRefObject<(() => void) | null>;
  getVideoHandle: (id: string) => GalleryVideoPlayerHandle | undefined;
  onPresentationChange: (presentation: GalleryViewerPresentation) => void;
  onClose: (index: number, playback?: GalleryPlaybackState) => void;
  onNavigate: (index: number) => void;
}

interface StageLayer {
  key: number;
  index: number;
  ready: boolean;
}

interface GalleryLightboxImageProps {
  item: GalleryMediaItem;
  isFullscreen: boolean;
  onReady: () => void;
  onToggleFullscreen: () => void;
}

const preventFocusOnClick = (event: React.MouseEvent) => event.preventDefault();

function GalleryLightboxImage({
  item,
  isFullscreen,
  onReady,
  onToggleFullscreen,
}: Readonly<GalleryLightboxImageProps>) {
  const { t } = useTranslation("game_details");
  const [aspectRatio, setAspectRatio] = useState<number | null>(null);
  const fullscreenLabel = isFullscreen ? t("exit_fullscreen") : t("fullscreen");

  const handleLoaded = (ratio: number) => {
    setAspectRatio(ratio);
    onReady();
  };

  return (
    <div
      className="gallery-lightbox__frame gallery-lightbox__frame--image"
      style={
        {
          "--media-aspect": aspectRatio ?? DEFAULT_ASPECT_RATIO,
        } as React.CSSProperties
      }
    >
      <img
        src={item.src}
        alt={item.alt}
        draggable={false}
        className="gallery-lightbox__image"
        onLoad={(event) => {
          const { naturalWidth, naturalHeight } = event.currentTarget;
          handleLoaded(
            naturalWidth && naturalHeight
              ? naturalWidth / naturalHeight
              : DEFAULT_ASPECT_RATIO
          );
        }}
        onError={() => handleLoaded(DEFAULT_ASPECT_RATIO)}
        onDoubleClick={onToggleFullscreen}
      />

      {!isFullscreen && (
        <button
          type="button"
          className="gallery-lightbox__frame-button gallery-lightbox__chrome"
          onClick={onToggleFullscreen}
          onMouseDown={preventFocusOnClick}
          aria-label={fullscreenLabel}
          data-tooltip-id={GALLERY_VIEWER_TOOLTIP_ID}
          data-tooltip-content={`${fullscreenLabel} (F)`}
          data-tooltip-place="top"
          data-gallery-chrome
        >
          <CornersOut size={26} weight="bold" />
        </button>
      )}
    </div>
  );
}

function GalleryLightboxContent({
  items,
  index,
  fullscreen = false,
  autoplay = true,
  videoHosts,
  videoHoldsChrome,
  toggleFullscreenRef,
  getVideoHandle,
  onPresentationChange,
  onClose,
  onNavigate,
}: Readonly<Omit<GalleryLightboxProps, "visible">>) {
  const { t } = useTranslation("game_details");
  const rootRef = useRef<HTMLDivElement>(null);
  const filmstripRef = useRef<HTMLDivElement>(null);
  const filmstripDrag = useDragScroll();
  const idleTimerRef = useRef<number>();
  const pointerOverChromeRef = useRef(false);
  const isFullscreenRef = useRef(false);
  const indexRef = useRef(index);
  const lastFullscreenExitRef = useRef(0);
  const closeOnFullscreenExitRef = useRef(fullscreen);
  const initialFullscreenRequestedRef = useRef(false);
  const layerKeyRef = useRef(0);
  const layerTimersRef = useRef<number[]>([]);

  const [isFullscreenActive, setIsFullscreen] = useState(false);
  const [exitingFullscreen, setExitingFullscreen] = useState(false);
  const exitingFullscreenRef = useRef(false);
  const isFullscreen = isFullscreenActive || exitingFullscreen;
  const [enteringFullscreen, setEnteringFullscreen] = useState(fullscreen);
  const [idle, setIdle] = useState(false);
  const [layers, setLayers] = useState<StageLayer[]>([
    { key: 0, index, ready: true },
  ]);

  const item = items[index];
  const isVideo = item?.type === "video";
  const hasPrevious = index > 0;
  const hasNext = index < items.length - 1;
  const platform = window.electron?.platform;

  isFullscreenRef.current = isFullscreen;
  indexRef.current = index;

  const close = useCallback(() => {
    const currentIndex = indexRef.current;
    const currentItem = items[currentIndex];
    const playback =
      currentItem?.type === "video"
        ? (getVideoHandle(currentItem.id)?.getState() ?? undefined)
        : undefined;
    onClose(currentIndex, playback);
  }, [items, getVideoHandle, onClose]);

  const holdChrome = isVideo ? videoHoldsChrome : !isFullscreen;
  const chromeHidden = idle && !holdChrome;

  const wake = useCallback(() => {
    setIdle(false);
    window.clearTimeout(idleTimerRef.current);
    if (pointerOverChromeRef.current) return;
    idleTimerRef.current = window.setTimeout(
      () => setIdle(true),
      isFullscreenRef.current
        ? FULLSCREEN_IDLE_TIMEOUT_MS
        : VIEWER_IDLE_TIMEOUT_MS
    );
  }, []);

  useEffect(() => {
    wake();
    return () => window.clearTimeout(idleTimerRef.current);
  }, [wake]);

  useEffect(() => {
    setLayers((current) => {
      if (current[current.length - 1]?.index === index) return current;
      layerKeyRef.current += 1;
      return [...current, { key: layerKeyRef.current, index, ready: false }];
    });
  }, [index]);

  useEffect(() => {
    const timers = layerTimersRef.current;
    return () => timers.forEach((timer) => window.clearTimeout(timer));
  }, []);

  const markLayerReady = useCallback((key: number) => {
    requestAnimationFrame(() =>
      requestAnimationFrame(() => {
        setLayers((current) =>
          current.map((layer) =>
            layer.key === key && !layer.ready
              ? { ...layer, ready: true }
              : layer
          )
        );

        layerTimersRef.current.push(
          window.setTimeout(() => {
            setLayers((current) => {
              const position = current.findIndex((layer) => layer.key === key);
              return position > 0 ? current.slice(position) : current;
            });
          }, LAYER_FADE_MS + 40)
        );
      })
    );
  }, []);

  useEffect(() => {
    layers.forEach((layer) => {
      if (!layer.ready && items[layer.index]?.type === "video") {
        markLayerReady(layer.key);
      }
    });
  }, [layers, items, markLayerReady]);

  const navigate = useCallback(
    (nextIndex: number) => {
      if (nextIndex < 0 || nextIndex >= items.length || nextIndex === index) {
        return;
      }
      const currentItem = items[index];
      const nextItem = items[nextIndex];
      if (currentItem?.type === "video") {
        getVideoHandle(currentItem.id)?.pause();
      }
      if (autoplay && nextItem?.type === "video") {
        getVideoHandle(nextItem.id)?.play();
      }
      onNavigate(nextIndex);
    },
    [items, index, autoplay, getVideoHandle, onNavigate]
  );

  const exitAndClose = useCallback(() => {
    if (exitingFullscreenRef.current) return;
    exitingFullscreenRef.current = true;
    setExitingFullscreen(true);
    document.exitFullscreen().catch(() => flushSync(close));
  }, [close]);

  const toggleFullscreen = useCallback(() => {
    const root = rootRef.current;
    if (!root) return;

    if (!document.fullscreenElement) {
      root.requestFullscreen({ navigationUI: "hide" }).catch(() => {});
    } else if (closeOnFullscreenExitRef.current) {
      exitAndClose();
    } else {
      document.exitFullscreen().catch(() => {});
    }
  }, [exitAndClose]);

  useEffect(() => {
    const root = rootRef.current;

    const onFullscreenChange = () => {
      const active = !!root && document.fullscreenElement === root;

      if (!active && closeOnFullscreenExitRef.current) {
        lastFullscreenExitRef.current = performance.now();
        flushSync(close);
        return;
      }

      setIsFullscreen(active);
      setEnteringFullscreen(false);

      if (active) return;
      lastFullscreenExitRef.current = performance.now();
    };

    document.addEventListener("fullscreenchange", onFullscreenChange);

    return () => {
      document.removeEventListener("fullscreenchange", onFullscreenChange);
    };
  }, [close]);

  useEffect(() => {
    const root = rootRef.current;

    if (
      root &&
      closeOnFullscreenExitRef.current &&
      !initialFullscreenRequestedRef.current
    ) {
      initialFullscreenRequestedRef.current = true;
      root.requestFullscreen({ navigationUI: "hide" }).catch(() => {
        if (document.fullscreenElement === root) return;
        closeOnFullscreenExitRef.current = false;
        setEnteringFullscreen(false);
      });
    }

    return () => {
      if (root && document.fullscreenElement === root) {
        document.exitFullscreen().catch(() => {});
      }
    };
  }, []);

  useEffect(() => {
    const previouslyFocused = document.activeElement as HTMLElement | null;
    rootRef.current?.focus({ preventScroll: true });

    return () => {
      previouslyFocused?.focus?.({ preventScroll: true });
    };
  }, []);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.ctrlKey || event.metaKey || event.altKey) return;

      const video = isVideo && item ? (getVideoHandle(item.id) ?? null) : null;
      const navigateOnArrow = !video || event.shiftKey;
      let wakeChrome = !!video;

      switch (resolveMediaKey(event.key)) {
        case "Escape":
          wakeChrome = false;
          if (video?.dismissMenu()) break;
          if (document.fullscreenElement) {
            if (closeOnFullscreenExitRef.current) {
              exitAndClose();
            } else {
              document.exitFullscreen().catch(() => {});
            }
            break;
          }
          if (
            performance.now() - lastFullscreenExitRef.current <
            ESCAPE_AFTER_FULLSCREEN_EXIT_MS
          ) {
            break;
          }
          close();
          break;
        case "f":
        case "F":
          wakeChrome = false;
          toggleFullscreen();
          break;
        case "ArrowLeft":
          if (navigateOnArrow) {
            wakeChrome = false;
            navigate(index - 1);
          } else {
            video?.seekBy(-SEEK_STEP_SECONDS);
          }
          break;
        case "ArrowRight":
          if (navigateOnArrow) {
            wakeChrome = false;
            navigate(index + 1);
          } else {
            video?.seekBy(SEEK_STEP_SECONDS);
          }
          break;
        case "PageUp":
          wakeChrome = false;
          navigate(index - 1);
          break;
        case "PageDown":
          wakeChrome = false;
          navigate(index + 1);
          break;
        case "Home":
          if (video) {
            video.seekToRatio(0);
          } else {
            navigate(0);
          }
          break;
        case "End":
          if (video) {
            video.seekToRatio(1);
          } else {
            navigate(items.length - 1);
          }
          break;
        case "ArrowUp":
          if (!video) return;
          video.changeVolume(VOLUME_STEP);
          break;
        case "ArrowDown":
          if (!video) return;
          video.changeVolume(-VOLUME_STEP);
          break;
        case " ":
        case "k":
        case "K":
          if (!video) return;
          video.togglePlay();
          break;
        case "m":
        case "M":
          if (!video) return;
          video.toggleMute();
          break;
        default:
          return;
      }

      event.preventDefault();
      event.stopPropagation();
      if (wakeChrome) wake();
    };

    window.addEventListener("keydown", onKeyDown, true);

    return () => {
      window.removeEventListener("keydown", onKeyDown, true);
    };
  }, [
    isVideo,
    item,
    index,
    items.length,
    getVideoHandle,
    navigate,
    close,
    exitAndClose,
    toggleFullscreen,
    wake,
  ]);

  useEffect(() => {
    const root = rootRef.current;
    if (!root) return undefined;

    const onWheel = (event: WheelEvent) => {
      event.preventDefault();
      const filmstrip = filmstripRef.current;
      if (filmstrip?.contains(event.target as Node)) {
        filmstrip.scrollLeft += event.deltaY + event.deltaX;
      }
    };

    const isBackdrop = (target: EventTarget | null) =>
      target === root ||
      (target instanceof HTMLElement &&
        (target.classList.contains("gallery-lightbox__stage") ||
          target.classList.contains("gallery-lightbox__layer")));

    let pressedOnBackdrop = false;

    const onPointerDown = (event: PointerEvent) => {
      pressedOnBackdrop = event.button === 0 && isBackdrop(event.target);
    };

    const onClick = (event: MouseEvent) => {
      const shouldClose = pressedOnBackdrop && isBackdrop(event.target);
      pressedOnBackdrop = false;
      if (shouldClose && !document.fullscreenElement) close();
    };

    root.addEventListener("wheel", onWheel, { passive: false });
    root.addEventListener("pointerdown", onPointerDown);
    root.addEventListener("click", onClick);

    return () => {
      root.removeEventListener("wheel", onWheel);
      root.removeEventListener("pointerdown", onPointerDown);
      root.removeEventListener("click", onClick);
    };
  }, [close]);

  useEffect(() => {
    [items[index - 1], items[index + 1]].forEach((neighbor) => {
      if (neighbor?.type === "image" && neighbor.src) {
        const image = new Image();
        image.src = neighbor.src;
      }
    });
  }, [items, index]);

  useEffect(() => {
    const filmstrip = filmstripRef.current;
    const thumbnail = filmstrip?.querySelector<HTMLElement>(
      ".gallery-lightbox__thumbnail--active"
    );
    if (!filmstrip || !thumbnail) return;

    filmstrip.scrollTo({
      left:
        thumbnail.offsetLeft -
        (filmstrip.clientWidth - thumbnail.clientWidth) / 2,
      behavior: "smooth",
    });
  }, [index, isFullscreen]);

  const handlePointerMove = (event: React.PointerEvent) => {
    pointerOverChromeRef.current = !!(event.target as HTMLElement).closest(
      "[data-gallery-chrome]"
    );
    wake();
  };

  const handlePointerLeave = () => {
    pointerOverChromeRef.current = false;
    window.clearTimeout(idleTimerRef.current);
    setIdle(true);
  };

  const activeVideoId = isVideo && item ? item.id : null;
  const borrowedVideoKey = layers
    .map((layer) => items[layer.index])
    .filter((layerItem) => layerItem?.type === "video")
    .map((layerItem) => layerItem.id)
    .join("|");

  useEffect(() => {
    onPresentationChange({
      isFullscreen,
      chromeHidden,
      activeVideoId,
      borrowedVideoIds: borrowedVideoKey ? borrowedVideoKey.split("|") : [],
    });
  }, [
    isFullscreen,
    chromeHidden,
    activeVideoId,
    borrowedVideoKey,
    onPresentationChange,
  ]);

  useEffect(() => {
    toggleFullscreenRef.current = toggleFullscreen;
    return () => {
      toggleFullscreenRef.current = null;
    };
  }, [toggleFullscreen, toggleFullscreenRef]);

  if (!item) return null;

  const showFilmstrip = items.length > 1 && !(isFullscreen && isVideo);

  return (
    <div
      ref={rootRef}
      className={cn("gallery-lightbox", {
        "gallery-lightbox--fullscreen": isFullscreen,
        "gallery-lightbox--entering-fullscreen": enteringFullscreen,
        "gallery-lightbox--chrome-hidden": chromeHidden,
        "gallery-lightbox--with-filmstrip": showFilmstrip,
        "gallery-lightbox--titlebar-offset":
          !isFullscreen && (platform === "win32" || platform === "darwin"),
      })}
      style={
        { "--layer-fade-duration": `${LAYER_FADE_MS}ms` } as React.CSSProperties
      }
      role="dialog"
      aria-modal="true"
      aria-label={item.alt}
      tabIndex={-1}
      onPointerMove={handlePointerMove}
      onPointerDown={wake}
      onPointerLeave={handlePointerLeave}
    >
      <div className="gallery-lightbox__stage">
        {layers.map((layer, position) => {
          const layerItem = items[layer.index];
          if (!layerItem) return null;

          const topLayer = layers[layers.length - 1];
          const isTop = position === layers.length - 1;

          return (
            <div
              key={layer.key}
              className={cn("gallery-lightbox__layer", {
                "gallery-lightbox__layer--visible": layer.ready,
                "gallery-lightbox__layer--inactive": !isTop,
                "gallery-lightbox__layer--leaving": !isTop && topLayer.ready,
              })}
            >
              {layerItem.type === "video" ? (
                videoHosts.has(layerItem.id) && (
                  <GalleryVideoSlot
                    host={videoHosts.get(layerItem.id)!}
                    mode="borrow"
                  />
                )
              ) : (
                <GalleryLightboxImage
                  item={layerItem}
                  isFullscreen={isFullscreen}
                  onReady={() => markLayerReady(layer.key)}
                  onToggleFullscreen={toggleFullscreen}
                />
              )}
            </div>
          );
        })}
      </div>

      <div
        className="gallery-lightbox__top-bar gallery-lightbox__chrome"
        data-gallery-chrome
      >
        <div className="gallery-lightbox__heading">
          <span className="gallery-lightbox__counter">
            {index + 1} / {items.length}
          </span>
          <span className="gallery-lightbox__title">{item.alt}</span>
        </div>

        {!isFullscreen && (
          <button
            type="button"
            onClick={close}
            onMouseDown={preventFocusOnClick}
            className="gallery-lightbox__icon-button"
            aria-label={t("close")}
            data-tooltip-id={GALLERY_VIEWER_TOOLTIP_ID}
            data-tooltip-content={`${t("close")} (Esc)`}
            data-tooltip-place="bottom"
          >
            <XIcon size={20} />
          </button>
        )}
      </div>

      {isFullscreen && !isVideo && !showFilmstrip && (
        <button
          type="button"
          onClick={toggleFullscreen}
          onMouseDown={preventFocusOnClick}
          className="gallery-lightbox__corner-button gallery-lightbox__chrome"
          aria-label={t("exit_fullscreen")}
          data-tooltip-id={GALLERY_VIEWER_TOOLTIP_ID}
          data-tooltip-content={`${t("exit_fullscreen")} (F)`}
          data-tooltip-place="top"
          data-gallery-chrome
        >
          <CornersIn size={34} weight="bold" />
        </button>
      )}

      <Tooltip
        id={GALLERY_VIEWER_TOOLTIP_ID}
        positionStrategy="fixed"
        style={{ zIndex: 10 }}
      />

      <button
        type="button"
        onClick={() => navigate(index - 1)}
        onMouseDown={preventFocusOnClick}
        disabled={!hasPrevious}
        className={cn(
          "gallery-lightbox__nav-button gallery-lightbox__nav-button--left gallery-lightbox__chrome",
          { "gallery-lightbox__nav-button--hidden": !hasPrevious }
        )}
        aria-label={t("previous_media")}
        data-gallery-chrome
      >
        <ChevronLeftIcon size={28} />
      </button>

      <button
        type="button"
        onClick={() => navigate(index + 1)}
        onMouseDown={preventFocusOnClick}
        disabled={!hasNext}
        className={cn(
          "gallery-lightbox__nav-button gallery-lightbox__nav-button--right gallery-lightbox__chrome",
          { "gallery-lightbox__nav-button--hidden": !hasNext }
        )}
        aria-label={t("next_media")}
        data-gallery-chrome
      >
        <ChevronRightIcon size={28} />
      </button>

      {showFilmstrip && (
        <div
          className="gallery-lightbox__filmstrip gallery-lightbox__chrome"
          data-gallery-chrome
        >
          <div
            ref={filmstripRef}
            className={cn("gallery-lightbox__filmstrip-track", {
              "gallery-lightbox__filmstrip-track--dragging":
                filmstripDrag.dragging,
            })}
            {...filmstripDrag.handlers}
          >
            {items.map((media, mediaIndex) => (
              <button
                key={media.id}
                type="button"
                className={cn("gallery-lightbox__thumbnail", {
                  "gallery-lightbox__thumbnail--active": mediaIndex === index,
                })}
                onClick={() => navigate(mediaIndex)}
                onMouseDown={preventFocusOnClick}
                aria-label={media.alt}
                aria-current={mediaIndex === index}
              >
                <img
                  src={media.thumbnail ?? media.poster ?? media.src}
                  alt=""
                  draggable={false}
                  loading="lazy"
                />
                {media.type === "video" && (
                  <span className="gallery-lightbox__thumbnail-play">
                    <Play size={12} weight="fill" />
                  </span>
                )}
              </button>
            ))}
          </div>

          {isFullscreen && !isVideo && (
            <button
              type="button"
              onClick={toggleFullscreen}
              onMouseDown={preventFocusOnClick}
              className="gallery-lightbox__filmstrip-exit"
              aria-label={t("exit_fullscreen")}
              data-tooltip-id={GALLERY_VIEWER_TOOLTIP_ID}
              data-tooltip-content={`${t("exit_fullscreen")} (F)`}
              data-tooltip-place="top"
            >
              <CornersIn size={34} weight="bold" />
            </button>
          )}
        </div>
      )}
    </div>
  );
}

export function GalleryLightbox({
  visible,
  ...props
}: Readonly<GalleryLightboxProps>) {
  if (!visible) return null;

  return createPortal(<GalleryLightboxContent {...props} />, document.body);
}
