import "./styles.scss";

import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import cn from "classnames";
import { useTranslation } from "react-i18next";
import {
  CaretLeftIcon,
  CaretRightIcon,
  CornersIn,
  Play,
} from "@phosphor-icons/react";
import {
  GalleryVideoSlot,
  type GalleryVideoHost,
} from "@renderer/pages/game-details/gallery-slider/gallery-video-host";
import {
  GALLERY_VIEWER_TOOLTIP_ID,
  SEEK_STEP_SECONDS,
  type GalleryVideoPlayerHandle,
} from "@renderer/pages/game-details/gallery-slider/gallery-video-player";
import type { GalleryMediaItem } from "@renderer/pages/game-details/gallery-slider/gallery-slider";
import { useDragScroll } from "@renderer/pages/game-details/gallery-slider/use-drag-scroll";
import { Tooltip as HoverTooltip } from "react-tooltip";
import {
  BumperBadge,
  FocusItem,
  NavigationLayer,
  VerticalFocusGroup,
} from "../../../common";
import { FocusRegionContext } from "../../../context";
import { useGamepad, useNavigationScreenActions } from "../../../../hooks";
import { NavigationAudioService } from "../../../../services";
import { GamepadButtonType } from "../../../../types";

export const MEDIA_VIEWER_IDLE_TIMEOUT_MS = 1000;
export const MEDIA_VIEWER_INDICATOR_TIMEOUT_MS = 800;
const LAYER_FADE_MS = 280;
const VOLUME_STEP = 0.05;
const DEFAULT_ASPECT_RATIO = 16 / 9;
const navigationAudio = NavigationAudioService.getInstance();
const LAYER_CLEANUP_MARGIN_MS = 40;

type ViewerDirection = "left" | "right" | "up" | "down";

const NAVIGATION_STEPS: Partial<Record<ViewerDirection, number>> = {
  left: -1,
  right: 1,
};
const QUALITY_FOCUS_STEPS: Partial<Record<ViewerDirection, number>> = {
  up: -1,
  down: 1,
};
const SEEK_SECONDS: Partial<Record<ViewerDirection, number>> = {
  left: -SEEK_STEP_SECONDS,
  right: SEEK_STEP_SECONDS,
};
const VOLUME_CHANGES: Partial<Record<ViewerDirection, number>> = {
  up: VOLUME_STEP,
  down: -VOLUME_STEP,
};

const applyVideoDirection = (
  video: GalleryVideoPlayerHandle,
  direction: ViewerDirection
) => {
  const seekSeconds = SEEK_SECONDS[direction];
  if (seekSeconds !== undefined) {
    video.seekBy(seekSeconds);
    return;
  }

  const volumeChange = VOLUME_CHANGES[direction];
  if (volumeChange !== undefined) video.changeVolume(volumeChange);
};

const withLayerReady = (layers: StageLayer[], key: number) =>
  layers.map((layer) =>
    layer.key === key && !layer.ready ? { ...layer, ready: true } : layer
  );

const withoutLayersBelow = (layers: StageLayer[], key: number) => {
  const position = layers.findIndex((layer) => layer.key === key);
  return position > 0 ? layers.slice(position) : layers;
};

const STAGE_FOCUS_ID = "game-media-viewer-stage";
const STAGE_REGION_ID = "game-media-viewer";

export interface MediaViewerPresentation {
  chromeHidden: boolean;
  activeVideoId: string | null;
  borrowedVideoIds: string[];
}

export interface MediaViewerProps {
  items: GalleryMediaItem[];
  index: number;
  autoplay: boolean;
  videoHosts: Map<string, GalleryVideoHost>;
  videoHoldsChrome: boolean;
  getVideoHandle: (id: string) => GalleryVideoPlayerHandle | undefined;
  onPresentationChange: (presentation: MediaViewerPresentation) => void;
  onNavigate: (index: number) => void;
  onClose: (index: number) => void;
}

interface StageLayer {
  key: number;
  index: number;
  ready: boolean;
}

interface MediaViewerImageProps {
  item: GalleryMediaItem;
  onReady: () => void;
}

function MediaViewerImage({ item, onReady }: Readonly<MediaViewerImageProps>) {
  const [aspectRatio, setAspectRatio] = useState(DEFAULT_ASPECT_RATIO);

  const handleLoaded = (ratio: number) => {
    setAspectRatio(ratio);
    onReady();
  };

  return (
    <div
      className="media-viewer__frame media-viewer__frame--image"
      style={{ "--media-aspect": aspectRatio } as React.CSSProperties}
    >
      <img
        src={item.src}
        alt={item.alt}
        draggable={false}
        className="media-viewer__image"
        onLoad={(event) => {
          const { naturalWidth, naturalHeight } = event.currentTarget;
          handleLoaded(
            naturalWidth && naturalHeight
              ? naturalWidth / naturalHeight
              : DEFAULT_ASPECT_RATIO
          );
        }}
        onError={() => handleLoaded(DEFAULT_ASPECT_RATIO)}
      />
    </div>
  );
}

export function MediaViewer({
  items,
  index,
  autoplay,
  videoHosts,
  videoHoldsChrome,
  getVideoHandle,
  onPresentationChange,
  onNavigate,
  onClose,
}: Readonly<MediaViewerProps>) {
  const { t } = useTranslation("game_details");
  const { onButtonPressed, isActiveGamepadEvent } = useGamepad();
  const idleTimerRef = useRef<number>();
  const layerKeyRef = useRef(0);
  const layerTimersRef = useRef<number[]>([]);
  const pointerOverChromeRef = useRef(false);
  const chromeHiddenRef = useRef(false);
  const filmstripRef = useRef<HTMLDivElement>(null);
  const rootRef = useRef<HTMLDialogElement>(null);
  const filmstripDrag = useDragScroll();

  const [idle, setIdle] = useState(true);
  const [chromeSuppressed, setChromeSuppressed] = useState(true);
  const [layers, setLayers] = useState<StageLayer[]>([
    { key: 0, index, ready: true },
  ]);

  const item = items[index];
  const isVideo = item?.type === "video";
  const hasPrevious = index > 0;
  const hasNext = index < items.length - 1;
  const chromeHidden =
    chromeSuppressed || (idle && !(isVideo && videoHoldsChrome));
  chromeHiddenRef.current = chromeHidden;

  const wake = useCallback(() => {
    setIdle(false);
    setChromeSuppressed(false);
    window.clearTimeout(idleTimerRef.current);
    if (pointerOverChromeRef.current) return;
    idleTimerRef.current = window.setTimeout(
      () => setIdle(true),
      MEDIA_VIEWER_IDLE_TIMEOUT_MS
    );
  }, []);

  useEffect(() => {
    const root = rootRef.current;
    if (!root) return undefined;

    const onPointerMove = (event: PointerEvent) => {
      pointerOverChromeRef.current =
        event.target instanceof Element &&
        event.target.closest("[data-gallery-chrome]") !== null;
      wake();
    };

    root.addEventListener("pointermove", onPointerMove);
    root.addEventListener("pointerdown", wake);

    return () => {
      root.removeEventListener("pointermove", onPointerMove);
      root.removeEventListener("pointerdown", wake);
    };
  }, [wake]);

  const hideChrome = useCallback(() => {
    window.clearTimeout(idleTimerRef.current);
    setIdle(true);
    setChromeSuppressed(true);
  }, []);

  useEffect(() => {
    const timers = layerTimersRef.current;
    return () => {
      window.clearTimeout(idleTimerRef.current);
      timers.forEach((timer) => window.clearTimeout(timer));
    };
  }, [wake]);

  useEffect(() => {
    setLayers((current) => {
      if (current[current.length - 1]?.index === index) return current;
      layerKeyRef.current += 1;
      return [...current, { key: layerKeyRef.current, index, ready: false }];
    });
  }, [index]);

  const revealLayer = useCallback((key: number) => {
    setLayers((current) => withLayerReady(current, key));
    layerTimersRef.current.push(
      window.setTimeout(
        () => setLayers((current) => withoutLayersBelow(current, key)),
        LAYER_FADE_MS + LAYER_CLEANUP_MARGIN_MS
      )
    );
  }, []);

  const markLayerReady = useCallback(
    (key: number) => {
      requestAnimationFrame(() =>
        requestAnimationFrame(() => revealLayer(key))
      );
    },
    [revealLayer]
  );

  useEffect(() => {
    layers.forEach((layer) => {
      if (!layer.ready && items[layer.index]?.type === "video") {
        markLayerReady(layer.key);
      }
    });
  }, [layers, items, markLayerReady]);

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
      ".media-viewer__thumbnail--active"
    );
    if (!filmstrip || !thumbnail) return;

    filmstrip.scrollTo({
      left:
        thumbnail.offsetLeft -
        (filmstrip.clientWidth - thumbnail.clientWidth) / 2,
      behavior: "smooth",
    });
  }, [index, isVideo]);

  const close = useCallback(() => onClose(index), [index, onClose]);

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

  const activeVideoItemId = isVideo && item ? item.id : null;
  const getActiveVideo = useCallback(
    () => (activeVideoItemId ? getVideoHandle(activeVideoItemId) : undefined),
    [activeVideoItemId, getVideoHandle]
  );

  const handleDirection = useCallback(
    (direction: ViewerDirection) => {
      const activeVideo = getActiveVideo();

      if (activeVideo?.isQualityMenuOpen()) {
        const focusStep = QUALITY_FOCUS_STEPS[direction];
        if (focusStep !== undefined) {
          activeVideo.moveQualityFocus(focusStep);
          navigationAudio.play("scroll");
        }
      } else if (!chromeHiddenRef.current) {
        if (activeVideo) {
          applyVideoDirection(activeVideo, direction);
        } else {
          const step = NAVIGATION_STEPS[direction];
          if (step !== undefined) navigate(index + step);
        }
      }

      wake();
    },
    [getActiveVideo, index, navigate, wake]
  );

  const handleBack = useCallback(() => {
    if (getActiveVideo()?.dismissMenu()) {
      wake();
      return;
    }
    close();
  }, [getActiveVideo, close, wake]);

  const handleToggleMute = useCallback(() => {
    const activeVideo = getActiveVideo();
    if (!activeVideo) return;
    activeVideo.toggleMute();
    wake();
  }, [getActiveVideo, wake]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.ctrlKey || event.metaKey || event.altKey || event.repeat) {
        return;
      }

      const key = event.key.toLowerCase();
      let step = 0;
      if (event.key === "ArrowLeft" || key === "a") step = -1;
      if (event.key === "ArrowRight" || key === "d") step = 1;

      if (step !== 0 && (event.shiftKey || !getActiveVideo())) {
        event.preventDefault();
        event.stopImmediatePropagation();
        navigate(index + step);
        hideChrome();
        return;
      }

      if (key === "m") {
        handleToggleMute();
      } else if (key === "f") {
        close();
      } else {
        return;
      }

      event.preventDefault();
      event.stopPropagation();
    };

    window.addEventListener("keydown", onKeyDown, true);

    return () => {
      window.removeEventListener("keydown", onKeyDown, true);
    };
  }, [close, getActiveVideo, handleToggleMute, hideChrome, index, navigate]);

  const handleQualityMenu = useCallback(() => {
    const activeVideo = getActiveVideo();
    if (!activeVideo) return;
    const wasOpen = activeVideo.isQualityMenuOpen();
    if (activeVideo.toggleQualityMenu()) {
      navigationAudio.play(wasOpen ? "back" : "select");
    }
    wake();
  }, [getActiveVideo, wake]);

  useNavigationScreenActions({
    press: { b: handleBack, x: handleToggleMute, y: handleQualityMenu },
    direction: {
      left: () => handleDirection("left"),
      right: () => handleDirection("right"),
      up: () => handleDirection("up"),
      down: () => handleDirection("down"),
    },
  });

  useEffect(() => {
    const navigateWithBumper = (nextIndex: number) => {
      if (!items[nextIndex]) return;
      navigate(nextIndex);
      hideChrome();
    };

    const removeLeftBumper = onButtonPressed(
      GamepadButtonType.LEFT_BUMPER,
      (event) => {
        if (!isActiveGamepadEvent(event)) return;
        navigateWithBumper(index - 1);
      }
    );
    const removeRightBumper = onButtonPressed(
      GamepadButtonType.RIGHT_BUMPER,
      (event) => {
        if (!isActiveGamepadEvent(event)) return;
        navigateWithBumper(index + 1);
      }
    );

    return () => {
      removeLeftBumper();
      removeRightBumper();
    };
  }, [
    hideChrome,
    index,
    isActiveGamepadEvent,
    items,
    navigate,
    onButtonPressed,
    wake,
  ]);

  const handlePrimary = useCallback(() => {
    const activeVideo = getActiveVideo();
    if (!activeVideo) return;
    if (activeVideo.isQualityMenuOpen()) {
      activeVideo.selectFocusedQuality();
    } else {
      activeVideo.togglePlay();
    }
    wake();
  }, [getActiveVideo, wake]);

  const borrowedVideoKey = layers
    .map((layer) => items[layer.index])
    .filter((layerItem) => layerItem?.type === "video")
    .map((layerItem) => layerItem.id)
    .join("|");

  useEffect(() => {
    onPresentationChange({
      chromeHidden,
      activeVideoId: activeVideoItemId,
      borrowedVideoIds: borrowedVideoKey ? borrowedVideoKey.split("|") : [],
    });
  }, [chromeHidden, activeVideoItemId, borrowedVideoKey, onPresentationChange]);

  if (!item) return null;

  const portalTarget =
    document.getElementById("big-picture") ??
    document.getElementById("root") ??
    document.body;

  return createPortal(
    <FocusRegionContext.Provider value={null}>
      <dialog
        open
        ref={rootRef}
        className={cn("media-viewer", {
          "media-viewer--chrome-hidden": chromeHidden,
          "media-viewer--video": isVideo,
        })}
        aria-modal="true"
        aria-label={item.alt}
      >
        <NavigationLayer
          rootRegionId={STAGE_REGION_ID}
          initialFocusId={STAGE_FOCUS_ID}
          restoreFocusOnUnmount
        >
          <VerticalFocusGroup
            regionId={STAGE_REGION_ID}
            className="media-viewer__stage-region"
          >
            <FocusItem
              id={STAGE_FOCUS_ID}
              actions={{ primary: handlePrimary }}
              asChild
            >
              <div className="media-viewer__stage">
                {layers.map((layer, position) => {
                  const layerItem = items[layer.index];
                  if (!layerItem) return null;

                  const topLayer = layers[layers.length - 1];
                  const isTop = position === layers.length - 1;
                  const host = videoHosts.get(layerItem.id);

                  return (
                    <div
                      key={layer.key}
                      className={cn("media-viewer__layer", {
                        "media-viewer__layer--visible": layer.ready,
                        "media-viewer__layer--inactive": !isTop,
                        "media-viewer__layer--leaving":
                          !isTop && topLayer.ready,
                      })}
                    >
                      {layerItem.type === "video" ? (
                        host && <GalleryVideoSlot host={host} mode="borrow" />
                      ) : (
                        <MediaViewerImage
                          item={layerItem}
                          onReady={() => markLayerReady(layer.key)}
                        />
                      )}
                    </div>
                  );
                })}
              </div>
            </FocusItem>
          </VerticalFocusGroup>
        </NavigationLayer>

        <div className="media-viewer__top-bar media-viewer__chrome">
          <span className="media-viewer__counter">
            {index + 1} / {items.length}
          </span>
          <span className="media-viewer__title">{item.alt}</span>
        </div>

        <div
          className={cn(
            "media-viewer__nav media-viewer__nav--left media-viewer__chrome",
            { "media-viewer__nav--hidden": !hasPrevious }
          )}
          data-gallery-chrome
        >
          <button
            type="button"
            className="media-viewer__nav-button"
            onClick={() => navigate(index - 1)}
            aria-label={t("previous_media")}
            tabIndex={-1}
          >
            <CaretLeftIcon size={32} weight="bold" />
          </button>
          <BumperBadge label="LB" />
        </div>

        <div
          className={cn(
            "media-viewer__nav media-viewer__nav--right media-viewer__chrome",
            { "media-viewer__nav--hidden": !hasNext }
          )}
          data-gallery-chrome
        >
          <button
            type="button"
            className="media-viewer__nav-button"
            onClick={() => navigate(index + 1)}
            aria-label={t("next_media")}
            tabIndex={-1}
          >
            <CaretRightIcon size={32} weight="bold" />
          </button>
          <BumperBadge label="RB" />
        </div>

        {!isVideo && (
          <div
            className="media-viewer__footer media-viewer__chrome"
            data-gallery-chrome
          >
            <div
              ref={filmstripRef}
              className={cn("media-viewer__filmstrip", {
                "media-viewer__filmstrip--dragging": filmstripDrag.dragging,
              })}
              {...filmstripDrag.handlers}
            >
              {items.map((media, mediaIndex) => (
                <button
                  key={media.id}
                  type="button"
                  className={cn("media-viewer__thumbnail", {
                    "media-viewer__thumbnail--active": mediaIndex === index,
                  })}
                  onClick={() => navigate(mediaIndex)}
                  aria-label={media.alt}
                  tabIndex={-1}
                >
                  <img
                    src={media.thumbnail ?? media.poster ?? media.src}
                    alt=""
                    draggable={false}
                    loading="lazy"
                  />
                  {media.type === "video" && (
                    <span className="media-viewer__thumbnail-play">
                      <Play size={14} weight="fill" />
                    </span>
                  )}
                </button>
              ))}
            </div>

            <button
              type="button"
              className="media-viewer__exit-button"
              onClick={close}
              aria-label={t("exit_fullscreen")}
              tabIndex={-1}
              data-tooltip-id={GALLERY_VIEWER_TOOLTIP_ID}
              data-tooltip-content={`${t("exit_fullscreen")} (F)`}
              data-tooltip-place="top"
            >
              <CornersIn size={34} weight="bold" />
            </button>
          </div>
        )}

        <HoverTooltip
          id={GALLERY_VIEWER_TOOLTIP_ID}
          className="media-viewer__tooltip"
          classNameArrow="media-viewer__tooltip-arrow"
          positionStrategy="fixed"
          opacity={1}
        />
      </dialog>
    </FocusRegionContext.Provider>,
    portalTarget
  );
}
