import "./styles.scss";

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
  type SyntheticEvent,
} from "react";
import { createPortal } from "react-dom";
import cn from "classnames";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { useTranslation } from "react-i18next";
import {
  CaretLeftIcon,
  CaretRightIcon,
  CornersIn,
  Play,
  SidebarSimpleIcon,
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
  HorizontalFocusGroup,
  NavigationLayer,
  VerticalFocusGroup,
} from "../../../common";
import {
  FocusLayerReporter,
  FocusRegionContext,
  useFocusLayerTracker,
} from "../../../context";
import {
  useGamepad,
  useIsLayerOnTop,
  useNavigationScreenActions,
} from "../../../../hooks";
import {
  NavigationAudioService,
  NavigationService,
  type FocusOverrides,
} from "../../../../services";
import { GamepadAxisDirection, GamepadButtonType } from "../../../../types";

export const MEDIA_VIEWER_IDLE_TIMEOUT_MS = 1000;
export const MEDIA_VIEWER_INDICATOR_TIMEOUT_MS = 800;
const LAYER_FADE_MS = 280;
const VOLUME_STEP = 0.05;
const DEFAULT_ASPECT_RATIO = 16 / 9;
const navigationAudio = NavigationAudioService.getInstance();
const navigationService = NavigationService.getInstance();
const EMPTY_VIDEO_HOSTS = new Map<string, GalleryVideoHost>();
const getNoVideoHandle = (): GalleryVideoPlayerHandle | undefined => undefined;
const ignorePresentation = () => {};
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
const SIDEBAR_ROOT_REGION_ID = "game-media-viewer-root";
const SIDEBAR_PANEL_ID = "game-media-viewer-sidebar";
const SIDEBAR_MIN_WIDTH = 340;
const SIDEBAR_MAX_WIDTH = 460;
const SIDEBAR_VIEWPORT_RATIO = 0.3;
const SIDEBAR_CONTENT_OFFSET = 48;
const SIDEBAR_SPRING = {
  type: "spring",
  stiffness: 340,
  damping: 36,
  mass: 0.9,
} as const;
const SIDEBAR_CONTENT_EASE = [0.22, 1, 0.36, 1] as const;
const INSTANT_TRANSITION = { duration: 0 };
const SIDEBAR_CONTENT_TRANSITION = {
  duration: 0.26,
  ease: SIDEBAR_CONTENT_EASE,
};

const getSidebarTransitions = (prefersReducedMotion: boolean | null) =>
  prefersReducedMotion
    ? { panel: INSTANT_TRANSITION, content: INSTANT_TRANSITION }
    : { panel: SIDEBAR_SPRING, content: SIDEBAR_CONTENT_TRANSITION };

const getPortalTarget = () =>
  document.getElementById("big-picture") ??
  document.getElementById("root") ??
  document.body;

const getSidebarWidth = () =>
  Math.round(
    Math.min(
      SIDEBAR_MAX_WIDTH,
      Math.max(SIDEBAR_MIN_WIDTH, window.innerWidth * SIDEBAR_VIEWPORT_RATIO)
    )
  );

function useSidebarWidth() {
  const [width, setWidth] = useState(getSidebarWidth);

  useEffect(() => {
    const update = () => setWidth(getSidebarWidth());
    window.addEventListener("resize", update);
    return () => window.removeEventListener("resize", update);
  }, []);

  return width;
}

const isTypingInField = () => {
  const activeElement = globalThis.document.activeElement;

  return (
    activeElement instanceof HTMLInputElement ||
    activeElement instanceof HTMLTextAreaElement ||
    (activeElement instanceof HTMLElement && activeElement.isContentEditable)
  );
};

const SIDEBAR_STEP_KEYS: Partial<Record<string, number>> = {
  PageUp: -1,
  PageDown: 1,
};

const isModifiedOrRepeatedKey = (event: KeyboardEvent) =>
  event.ctrlKey || event.metaKey || event.altKey || event.repeat;

const getKeyboardStep = (event: KeyboardEvent, hasSidebar: boolean) => {
  if (hasSidebar) return SIDEBAR_STEP_KEYS[event.key] ?? 0;

  const key = event.key.toLowerCase();
  if (event.key === "ArrowLeft" || key === "a") return -1;
  if (event.key === "ArrowRight" || key === "d") return 1;
  return 0;
};

export interface MediaViewerImageRenderProps {
  item: GalleryMediaItem;
  className: string;
  onLoad: (event: SyntheticEvent<HTMLImageElement>) => void;
  onPreviewReady: (aspectRatio: number) => void;
  onError: () => void;
}

export interface MediaViewerPresentation {
  chromeHidden: boolean;
  activeVideoId: string | null;
  borrowedVideoIds: string[];
}

export interface MediaViewerProps {
  items: GalleryMediaItem[];
  index: number;
  autoplay?: boolean;
  videoHosts?: Map<string, GalleryVideoHost>;
  videoHoldsChrome?: boolean;
  getVideoHandle?: (id: string) => GalleryVideoPlayerHandle | undefined;
  onPresentationChange?: (presentation: MediaViewerPresentation) => void;
  onNavigate: (index: number) => void;
  onClose: (index: number) => void;
  sidebar?: ReactNode;
  className?: string;
  showFilmstrip?: boolean;
  showCounter?: boolean;
  canNavigatePastEnd?: boolean;
  renderImage?: (props: MediaViewerImageRenderProps) => ReactNode;
  onStagePrimary?: () => void;
  onNavigatePastEnd?: () => void;
  stageNavigationOverrides?: FocusOverrides;
}

export const MEDIA_VIEWER_STAGE_FOCUS_ID = STAGE_FOCUS_ID;

interface StageLayer {
  key: number;
  itemId: string | undefined;
  ready: boolean;
}

interface MediaViewerImageProps {
  item: GalleryMediaItem;
  onReady: () => void;
  renderImage?: (props: MediaViewerImageRenderProps) => ReactNode;
}

function MediaViewerImage({
  item,
  onReady,
  renderImage,
}: Readonly<MediaViewerImageProps>) {
  const [aspectRatio, setAspectRatio] = useState(DEFAULT_ASPECT_RATIO);

  const handleLoaded = (ratio: number) => {
    setAspectRatio(ratio);
    onReady();
  };

  const handleLoad = (event: SyntheticEvent<HTMLImageElement>) => {
    const { naturalWidth, naturalHeight } = event.currentTarget;
    handleLoaded(
      naturalWidth && naturalHeight
        ? naturalWidth / naturalHeight
        : DEFAULT_ASPECT_RATIO
    );
  };
  const handleError = () => handleLoaded(DEFAULT_ASPECT_RATIO);

  return (
    <div
      className="media-viewer__frame media-viewer__frame--image"
      style={{ "--media-aspect": aspectRatio } as React.CSSProperties}
    >
      {renderImage ? (
        renderImage({
          item,
          className: "media-viewer__image",
          onLoad: handleLoad,
          onPreviewReady: handleLoaded,
          onError: handleError,
        })
      ) : (
        <img
          src={item.src}
          alt={item.alt}
          draggable={false}
          className="media-viewer__image"
          onLoad={handleLoad}
          onError={handleError}
        />
      )}
    </div>
  );
}

export function MediaViewer({
  items,
  index,
  autoplay = false,
  videoHosts = EMPTY_VIDEO_HOSTS,
  videoHoldsChrome = false,
  getVideoHandle = getNoVideoHandle,
  onPresentationChange = ignorePresentation,
  onNavigate,
  onClose,
  sidebar,
  className,
  showFilmstrip = true,
  showCounter = true,
  canNavigatePastEnd = false,
  renderImage,
  onStagePrimary,
  onNavigatePastEnd,
  stageNavigationOverrides,
}: Readonly<MediaViewerProps>) {
  const hasSidebar = sidebar !== undefined && sidebar !== null;
  const {
    layerId: viewerLayerId,
    handleLayerChange,
    isActiveLayer: isViewerOnTop,
  } = useFocusLayerTracker();
  const isViewerLayerOnTop = useIsLayerOnTop(viewerLayerId);
  const { t } = useTranslation("game_details");
  const { t: tBigPicture } = useTranslation("big_picture");
  const prefersReducedMotion = useReducedMotion();
  const sidebarWidth = useSidebarWidth();
  const [isSidebarHidden, setIsSidebarHidden] = useState(false);
  const { onButtonPressed, onStickMove, isActiveGamepadEvent } = useGamepad();
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
    { key: 0, itemId: items[index]?.id, ready: true },
  ]);

  const item = items[index];
  const isVideo = item?.type === "video";
  const hasPrevious = index > 0;
  const hasNext = index < items.length - 1 || canNavigatePastEnd;
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

  const currentItemId = item?.id;
  const itemsById = useMemo(
    () => new Map(items.map((mediaItem) => [mediaItem.id, mediaItem])),
    [items]
  );
  const getLayerItem = useCallback(
    (layer: StageLayer) =>
      layer.itemId === undefined ? undefined : itemsById.get(layer.itemId),
    [itemsById]
  );

  useEffect(() => {
    setLayers((current) => {
      if (current[current.length - 1]?.itemId === currentItemId) return current;
      layerKeyRef.current += 1;
      return [
        ...current,
        { key: layerKeyRef.current, itemId: currentItemId, ready: false },
      ];
    });
  }, [currentItemId]);

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
      if (!layer.ready && getLayerItem(layer)?.type === "video") {
        markLayerReady(layer.key);
      }
    });
  }, [layers, getLayerItem, markLayerReady]);

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
      if (nextIndex === items.length && canNavigatePastEnd) {
        onNavigatePastEnd?.();
        return;
      }
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
    [
      items,
      index,
      autoplay,
      canNavigatePastEnd,
      getVideoHandle,
      onNavigate,
      onNavigatePastEnd,
    ]
  );

  const activeVideoItemId = item?.type === "video" ? item.id : null;
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
    const shortcuts: Partial<Record<string, () => void>> = {
      m: handleToggleMute,
      f: close,
    };

    const onKeyDown = (event: KeyboardEvent) => {
      if (isModifiedOrRepeatedKey(event)) return;
      if (!isViewerOnTop() || (hasSidebar && isTypingInField())) return;

      const step = getKeyboardStep(event, hasSidebar);
      if (step !== 0 && (event.shiftKey || !getActiveVideo())) {
        event.preventDefault();
        event.stopImmediatePropagation();
        navigate(index + step);
        hideChrome();
        return;
      }

      const shortcut = shortcuts[event.key.toLowerCase()];
      if (!shortcut) return;

      shortcut();
      event.preventDefault();
      event.stopPropagation();
    };

    window.addEventListener("keydown", onKeyDown, true);

    return () => {
      window.removeEventListener("keydown", onKeyDown, true);
    };
  }, [
    close,
    getActiveVideo,
    handleToggleMute,
    hasSidebar,
    hideChrome,
    index,
    isViewerOnTop,
    navigate,
  ]);

  const toggleSidebar = useCallback(() => {
    if (
      !isSidebarHidden &&
      navigationService.getCurrentFocusId() !== STAGE_FOCUS_ID
    ) {
      navigationService.setFocus(STAGE_FOCUS_ID);
    }
    setIsSidebarHidden((hidden) => !hidden);
    navigationAudio.play("select");
    wake();
  }, [isSidebarHidden, wake]);

  const handleQualityMenu = useCallback(() => {
    const activeVideo = getActiveVideo();
    if (!activeVideo) return;
    const wasOpen = activeVideo.isQualityMenuOpen();
    if (activeVideo.toggleQualityMenu()) {
      navigationAudio.play(wasOpen ? "back" : "select");
    }
    wake();
  }, [getActiveVideo, wake]);

  const stageScreenActions = hasSidebar
    ? { press: { b: handleBack, y: toggleSidebar } }
    : {
        press: { b: handleBack, x: handleToggleMute, y: handleQualityMenu },
        direction: {
          left: () => handleDirection("left"),
          right: () => handleDirection("right"),
          up: () => handleDirection("up"),
          down: () => handleDirection("down"),
        },
      };

  useNavigationScreenActions(isViewerLayerOnTop ? stageScreenActions : {});

  useEffect(() => {
    const navigateWithBumper = (nextIndex: number) => {
      if (!isViewerOnTop()) return;
      const isPastEnd = canNavigatePastEnd && nextIndex === items.length;
      if (!items[nextIndex] && !isPastEnd) return;
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
    canNavigatePastEnd,
    hideChrome,
    index,
    isActiveGamepadEvent,
    isViewerOnTop,
    items,
    navigate,
    onButtonPressed,
    wake,
  ]);

  useEffect(() => {
    if (!hasSidebar) return undefined;

    const wakeOnGamepadInput = (
      event: Parameters<typeof isActiveGamepadEvent>[0]
    ) => {
      if (isActiveGamepadEvent(event) && isViewerOnTop()) wake();
    };

    const removeListeners = [
      GamepadButtonType.DPAD_UP,
      GamepadButtonType.DPAD_DOWN,
      GamepadButtonType.DPAD_LEFT,
      GamepadButtonType.DPAD_RIGHT,
      GamepadButtonType.BUTTON_A,
    ]
      .map((button) => onButtonPressed(button, wakeOnGamepadInput))
      .concat(
        [
          GamepadAxisDirection.UP,
          GamepadAxisDirection.DOWN,
          GamepadAxisDirection.LEFT,
          GamepadAxisDirection.RIGHT,
        ].map((direction) => onStickMove("left", direction, wakeOnGamepadInput))
      );

    return () => {
      removeListeners.forEach((removeListener) => removeListener());
    };
  }, [
    hasSidebar,
    isActiveGamepadEvent,
    isViewerOnTop,
    onButtonPressed,
    onStickMove,
    wake,
  ]);

  const handlePrimary = useCallback(() => {
    const activeVideo = getActiveVideo();
    if (!activeVideo) {
      onStagePrimary?.();
      return;
    }
    if (activeVideo.isQualityMenuOpen()) {
      activeVideo.selectFocusedQuality();
    } else {
      activeVideo.togglePlay();
    }
    wake();
  }, [getActiveVideo, onStagePrimary, wake]);

  const borrowedVideoKey = layers
    .map(getLayerItem)
    .flatMap((layerItem) => (layerItem?.type === "video" ? [layerItem.id] : []))
    .join("|");

  useEffect(() => {
    onPresentationChange({
      chromeHidden,
      activeVideoId: activeVideoItemId,
      borrowedVideoIds: borrowedVideoKey ? borrowedVideoKey.split("|") : [],
    });
  }, [chromeHidden, activeVideoItemId, borrowedVideoKey, onPresentationChange]);

  if (!item) return null;

  const sidebarToggleLabel = tBigPicture(
    isSidebarHidden ? "media_viewer_show_sidebar" : "media_viewer_hide_sidebar"
  );
  const { panel: sidebarTransition, content: sidebarContentTransition } =
    getSidebarTransitions(prefersReducedMotion);
  const portalTarget = getPortalTarget();

  const stageRegion = (
    <VerticalFocusGroup
      regionId={STAGE_REGION_ID}
      className="media-viewer__stage-region"
    >
      <FocusItem
        id={STAGE_FOCUS_ID}
        actions={{ primary: handlePrimary }}
        navigationOverrides={
          isSidebarHidden ? undefined : stageNavigationOverrides
        }
        asChild
      >
        <div className="media-viewer__stage">
          {layers.map((layer, position) => {
            const layerItem = getLayerItem(layer);
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
                  "media-viewer__layer--leaving": !isTop && topLayer.ready,
                })}
              >
                {layerItem.type === "video" ? (
                  host && <GalleryVideoSlot host={host} mode="borrow" />
                ) : (
                  <MediaViewerImage
                    item={layerItem}
                    onReady={() => markLayerReady(layer.key)}
                    renderImage={renderImage}
                  />
                )}
              </div>
            );
          })}
        </div>
      </FocusItem>
    </VerticalFocusGroup>
  );

  const chrome = (
    <>
      <div className="media-viewer__top-bar media-viewer__chrome">
        {showCounter ? (
          <span className="media-viewer__counter">
            {index + 1} / {items.length}
          </span>
        ) : null}
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
          {showFilmstrip ? (
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
          ) : null}

          {hasSidebar ? (
            <div className="media-viewer__sidebar-toggle">
              <button
                type="button"
                className="media-viewer__sidebar-toggle-button"
                onClick={toggleSidebar}
                aria-label={sidebarToggleLabel}
                aria-expanded={!isSidebarHidden}
                aria-controls={SIDEBAR_PANEL_ID}
                tabIndex={-1}
                data-tooltip-id={GALLERY_VIEWER_TOOLTIP_ID}
                data-tooltip-content={sidebarToggleLabel}
                data-tooltip-place="top"
              >
                <SidebarSimpleIcon size={30} weight="bold" mirrored />
              </button>
              <BumperBadge label="Y" className="bumper-badge--round" />
            </div>
          ) : null}

          <div className="media-viewer__exit">
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
            <BumperBadge label="B" className="bumper-badge--round" />
          </div>
        </div>
      )}
    </>
  );

  return createPortal(
    <FocusRegionContext.Provider value={null}>
      <dialog
        open
        ref={rootRef}
        className={cn("media-viewer", className, {
          "media-viewer--chrome-hidden": chromeHidden,
          "media-viewer--video": isVideo,
          "media-viewer--with-sidebar": hasSidebar,
        })}
        aria-modal="true"
        aria-label={item.alt}
      >
        {hasSidebar ? (
          <NavigationLayer
            rootRegionId={SIDEBAR_ROOT_REGION_ID}
            initialFocusId={STAGE_FOCUS_ID}
            restoreFocusOnUnmount
          >
            <FocusLayerReporter onLayerChange={handleLayerChange} />
            <HorizontalFocusGroup regionId={SIDEBAR_ROOT_REGION_ID} asChild>
              <div className="media-viewer__layout">
                <div className="media-viewer__main">
                  {stageRegion}
                  {chrome}
                </div>
                <AnimatePresence initial={false}>
                  {isSidebarHidden ? null : (
                    <motion.aside
                      key="sidebar"
                      id={SIDEBAR_PANEL_ID}
                      className="media-viewer__sidebar"
                      initial={{ width: 0 }}
                      animate={{ width: sidebarWidth }}
                      exit={{ width: 0 }}
                      transition={sidebarTransition}
                    >
                      <motion.div
                        className="media-viewer__sidebar-content"
                        style={{ width: sidebarWidth }}
                        initial={{ x: SIDEBAR_CONTENT_OFFSET, opacity: 0 }}
                        animate={{ x: 0, opacity: 1 }}
                        exit={{ x: SIDEBAR_CONTENT_OFFSET, opacity: 0 }}
                        transition={sidebarContentTransition}
                      >
                        {sidebar}
                      </motion.div>
                    </motion.aside>
                  )}
                </AnimatePresence>
              </div>
            </HorizontalFocusGroup>
          </NavigationLayer>
        ) : (
          <>
            <NavigationLayer
              rootRegionId={STAGE_REGION_ID}
              initialFocusId={STAGE_FOCUS_ID}
              restoreFocusOnUnmount
            >
              <FocusLayerReporter onLayerChange={handleLayerChange} />
              {stageRegion}
            </NavigationLayer>
            {chrome}
          </>
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
