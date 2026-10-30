import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
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
import { moveFocusWithinContainer } from "@renderer/hooks/use-focus-trap";
import { useFeedbackWidgetHidden } from "@renderer/hooks/use-feedback-widget-hidden";
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
import {
  isEditableTarget,
  isPointerActivity,
  isTopmostDialog,
  normalizeShortcutKey,
} from "./gallery-shortcuts";
import "./gallery-lightbox.scss";

const ESCAPE_AFTER_FULLSCREEN_EXIT_MS = 300;
const LAYER_FADE_MS = 280;
const LAYER_CLEANUP_MARGIN_MS = 40;
const OPEN_FADE_MS = 200;
const OPEN_FADE_FALLBACK_MARGIN_MS = 60;

const getPageRoot = () => document.getElementById("root");

let pageHolds = 0;
let restorePageSize: (() => void) | null = null;

const acquirePageHold = () => {
  pageHolds += 1;
  const page = getPageRoot();
  if (pageHolds > 1 || !page) return;

  const { width, height } = page.getBoundingClientRect();
  const previousWidth = page.style.width;
  const previousHeight = page.style.height;
  page.style.width = `${width}px`;
  page.style.height = `${height}px`;

  restorePageSize = () => {
    page.style.width = previousWidth;
    page.style.height = previousHeight;
  };
};

const releasePageHold = () => {
  if (pageHolds === 0) return;
  pageHolds -= 1;
  if (pageHolds > 0) return;
  restorePageSize?.();
  restorePageSize = null;
};

let fullscreenQueue: Promise<unknown> = Promise.resolve();

const queueFullscreen = (operation: () => Promise<void>) => {
  const run = fullscreenQueue.then(operation);
  fullscreenQueue = run.catch(() => {});
  return run;
};

const enterElementFullscreen = (element: HTMLElement) =>
  queueFullscreen(() =>
    document.fullscreenElement === element
      ? Promise.resolve()
      : element.requestFullscreen({ navigationUI: "hide" })
  );

const leaveFullscreen = () =>
  queueFullscreen(() =>
    document.fullscreenElement ? document.exitFullscreen() : Promise.resolve()
  ).catch(() => {});
const VOLUME_STEP = 0.05;
const DEFAULT_ASPECT_RATIO = 16 / 9;

export interface GalleryViewerPresentation {
  isFullscreen: boolean;
  chromeHidden: boolean;
  activeVideoId: string | null;
  borrowedVideoIds: string[];
}

export interface GalleryImageRenderContext {
  isFullscreen: boolean;
  onReady: () => void;
  onToggleFullscreen: () => void;
}

export interface GalleryLightboxProps {
  visible: boolean;
  items: GalleryMediaItem[];
  index: number;
  fullscreen?: boolean;
  initialChromeHidden?: boolean;
  autoplay?: boolean;
  videoHosts?: Map<string, GalleryVideoHost>;
  videoHoldsChrome?: boolean;
  toggleFullscreenRef?: React.MutableRefObject<(() => void) | null>;
  getVideoHandle?: (id: string) => GalleryVideoPlayerHandle | undefined;
  onPresentationChange?: (presentation: GalleryViewerPresentation) => void;
  renderImage?: (
    item: GalleryMediaItem,
    context: GalleryImageRenderContext
  ) => ReactNode;
  renderSidebar?: (item: GalleryMediaItem, index: number) => ReactNode;
  getCaption?: (
    item: GalleryMediaItem,
    context: { isSidebarOpen: boolean }
  ) => string | null;
  showFilmstrip?: boolean;
  showCounter?: boolean;
  hasMoreAfter?: boolean;
  trapFocus?: boolean;
  onNavigatePastEnd?: () => void;
  onClose: (index: number, playback?: GalleryPlaybackState) => void;
  onNavigate: (index: number) => void;
}

const NO_VIDEO_HOSTS = new Map<string, GalleryVideoHost>();
const getNoVideoHandle = (): GalleryVideoPlayerHandle | undefined => undefined;

const isInsideScrollable = (target: EventTarget | null) =>
  target instanceof Element &&
  target.closest("[data-gallery-scrollable], [role='dialog']") !== null;

interface StageLayer {
  key: number;
  itemId: string | undefined;
  ready: boolean;
}

export interface GalleryImageMediaHandlers {
  onImageLoad: (image: HTMLImageElement) => void;
  onAspectRatioReady: (aspectRatio: number) => void;
  onImageError: () => void;
  onDoubleClick: () => void;
}

interface GalleryLightboxImageProps extends GalleryImageRenderContext {
  item: GalleryMediaItem;
  imageClassName?: string;
  children?: ReactNode;
  onImageError?: () => void;
  renderMedia?: (handlers: GalleryImageMediaHandlers) => ReactNode;
}

const preventFocusOnClick = (event: React.MouseEvent) => event.preventDefault();

const withLayerReady = (layers: StageLayer[], key: number) =>
  layers.map((layer) =>
    layer.key === key && !layer.ready ? { ...layer, ready: true } : layer
  );

const withoutLayersBelow = (layers: StageLayer[], key: number) => {
  const position = layers.findIndex((layer) => layer.key === key);
  return position > 0 ? layers.slice(position) : layers;
};

type ShortcutResult = "wake" | "quiet" | null;

const isActivatingFocusedControl = (
  event: KeyboardEvent,
  root: HTMLElement | null
) => {
  if (event.key !== " " && event.key !== "Enter") return false;
  const target = event.target;
  if (!(target instanceof HTMLElement) || !root) return false;
  if (target === root || !root.contains(target)) return false;
  return target.closest("button") !== null;
};

export function GalleryLightboxImage({
  item,
  isFullscreen,
  imageClassName,
  children,
  onReady,
  onToggleFullscreen,
  onImageError,
  renderMedia,
}: Readonly<GalleryLightboxImageProps>) {
  const { t } = useTranslation("game_details");
  const [aspectRatio, setAspectRatio] = useState<number | null>(null);
  const fullscreenLabel = isFullscreen ? t("exit_fullscreen") : t("fullscreen");

  const handleLoaded = (ratio: number) => {
    setAspectRatio(ratio);
    onReady();
  };

  const handleImageLoad = ({ naturalWidth, naturalHeight }: HTMLImageElement) =>
    handleLoaded(
      naturalWidth && naturalHeight
        ? naturalWidth / naturalHeight
        : DEFAULT_ASPECT_RATIO
    );

  const handleImageError = () => {
    handleLoaded(DEFAULT_ASPECT_RATIO);
    onImageError?.();
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
      {renderMedia ? (
        renderMedia({
          onImageLoad: handleImageLoad,
          onAspectRatioReady: handleLoaded,
          onImageError: handleImageError,
          onDoubleClick: onToggleFullscreen,
        })
      ) : (
        <img
          src={item.src}
          alt={item.alt}
          draggable={false}
          className={cn("gallery-lightbox__image", imageClassName)}
          onLoad={(event) => handleImageLoad(event.currentTarget)}
          onError={handleImageError}
          onDoubleClick={onToggleFullscreen}
        />
      )}

      {children}

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

const renderDefaultImage = (
  item: GalleryMediaItem,
  context: GalleryImageRenderContext
) => <GalleryLightboxImage item={item} {...context} />;

function GalleryLightboxContent({
  items,
  index,
  fullscreen = false,
  initialChromeHidden = false,
  autoplay = true,
  videoHosts = NO_VIDEO_HOSTS,
  videoHoldsChrome = false,
  toggleFullscreenRef,
  getVideoHandle = getNoVideoHandle,
  onPresentationChange,
  renderImage,
  renderSidebar,
  getCaption,
  showFilmstrip: allowFilmstrip = true,
  showCounter = true,
  hasMoreAfter = false,
  trapFocus = false,
  onNavigatePastEnd,
  onClose,
  onNavigate,
}: Readonly<Omit<GalleryLightboxProps, "visible">>) {
  const { t } = useTranslation("game_details");
  useFeedbackWidgetHidden();
  const dialogRef = useRef<HTMLDialogElement>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const sidebarRef = useRef<HTMLDivElement>(null);
  const filmstripRef = useRef<HTMLDivElement>(null);
  const filmstripDrag = useDragScroll();
  const idleTimerRef = useRef<number>();
  const pointerOverChromeRef = useRef(false);
  const isFullscreenRef = useRef(false);
  const indexRef = useRef(index);
  const lastFullscreenExitRef = useRef(0);
  const closeOnFullscreenExitRef = useRef(fullscreen);
  const initialFullscreenRequestedRef = useRef(false);
  const unmountedRef = useRef(false);
  const pendingFullscreenRequestsRef = useRef(0);
  const leavingFullscreenRef = useRef(false);
  const pageHeldRef = useRef(false);
  const ownsFullscreenRef = useRef(false);
  const layerKeyRef = useRef(0);
  const layerTimersRef = useRef<number[]>([]);

  const [isFullscreenActive, setIsFullscreenActive] = useState(false);
  const [enteringFullscreen, setEnteringFullscreen] = useState(fullscreen);
  const [openFadeDone, setOpenFadeDone] = useState(!fullscreen);
  const isFullscreen = isFullscreenActive || enteringFullscreen;
  const isLinux = window.electron?.platform === "linux";
  const startsChromeHidden =
    initialChromeHidden || (fullscreen && items[index]?.type === "image");
  const [idle, setIdle] = useState(startsChromeHidden);
  const initialChromeHiddenRef = useRef(startsChromeHidden);
  const [layers, setLayers] = useState<StageLayer[]>([
    { key: 0, itemId: items[index]?.id, ready: true },
  ]);

  const item = items[index];
  const isVideo = item?.type === "video";
  const hasPrevious = index > 0;
  const hasNext = index < items.length - 1 || hasMoreAfter;
  const hasSidebar = Boolean(renderSidebar);
  const isSidebarOpen = hasSidebar && !isFullscreen;

  useEffect(() => {
    const sidebar = sidebarRef.current;
    if (!sidebar) return;
    sidebar.toggleAttribute("inert", !isSidebarOpen);
    if (!isSidebarOpen && sidebar.contains(document.activeElement)) {
      rootRef.current?.focus({ preventScroll: true });
    }
  }, [isSidebarOpen]);

  isFullscreenRef.current = isFullscreen;
  indexRef.current = index;
  const renderLayerImage = renderImage ?? renderDefaultImage;

  const close = useCallback(() => {
    const currentIndex = indexRef.current;
    const currentItem = items[currentIndex];
    const playback =
      currentItem?.type === "video"
        ? (getVideoHandle(currentItem.id)?.getState() ?? undefined)
        : undefined;
    if (ownsFullscreenRef.current || pendingFullscreenRequestsRef.current > 0) {
      ownsFullscreenRef.current = false;
      leavingFullscreenRef.current = true;
      void leaveFullscreen();
    }
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
    if (!initialChromeHiddenRef.current) wake();
    return () => window.clearTimeout(idleTimerRef.current);
  }, [wake]);

  const wasFullscreenRef = useRef(isFullscreen);

  useLayoutEffect(() => {
    const wasFullscreen = wasFullscreenRef.current;
    wasFullscreenRef.current = isFullscreen;
    if (!isFullscreen || wasFullscreen || isVideo) return;
    window.clearTimeout(idleTimerRef.current);
    setIdle(true);
  }, [isFullscreen, isVideo]);

  const currentItemId = item?.id;
  const itemsById = useMemo(
    () => new Map(items.map((mediaItem) => [mediaItem.id, mediaItem])),
    [items]
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

  useEffect(() => {
    const timers = layerTimersRef.current;
    return () => timers.forEach((timer) => window.clearTimeout(timer));
  }, []);

  const revealLayer = useCallback((key: number) => {
    setLayers((current) => withLayerReady(current, key));
    layerTimersRef.current.push(
      window.setTimeout(
        () => setLayers((current) => withoutLayersBelow(current, key)),
        LAYER_FADE_MS + LAYER_CLEANUP_MARGIN_MS
      )
    );
  }, []);

  const getLayerItem = useCallback(
    (layer: StageLayer) =>
      layer.itemId === undefined ? undefined : itemsById.get(layer.itemId),
    [itemsById]
  );

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

  const navigate = useCallback(
    (nextIndex: number) => {
      if (
        nextIndex >= items.length &&
        nextIndex === index + 1 &&
        hasMoreAfter
      ) {
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
      hasMoreAfter,
      getVideoHandle,
      onNavigate,
      onNavigatePastEnd,
    ]
  );

  const holdPage = useCallback(() => {
    if (pageHeldRef.current) return;
    pageHeldRef.current = true;
    acquirePageHold();
  }, []);

  const releasePage = useCallback(() => {
    if (!pageHeldRef.current) return;
    pageHeldRef.current = false;
    releasePageHold();
  }, []);

  const requestViewerFullscreen = useCallback(() => {
    const viewer = rootRef.current;
    if (!viewer) return Promise.reject(new Error("Viewer is not mounted"));

    holdPage();
    pendingFullscreenRequestsRef.current += 1;
    leavingFullscreenRef.current = false;

    return enterElementFullscreen(viewer).then(
      () => {
        pendingFullscreenRequestsRef.current -= 1;
        if (unmountedRef.current || leavingFullscreenRef.current) return;
        ownsFullscreenRef.current = true;
        if (document.fullscreenElement === viewer) {
          setIsFullscreenActive(true);
          setEnteringFullscreen(false);
        }
      },
      (error: unknown) => {
        pendingFullscreenRequestsRef.current -= 1;
        releasePage();
        throw error;
      }
    );
  }, [holdPage, releasePage]);

  const exitViewerFullscreen = useCallback(() => {
    if (
      !ownsFullscreenRef.current &&
      pendingFullscreenRequestsRef.current === 0
    )
      return;
    ownsFullscreenRef.current = false;
    leavingFullscreenRef.current = true;
    void leaveFullscreen();
  }, []);

  const toggleFullscreen = useCallback(() => {
    if (closeOnFullscreenExitRef.current) {
      close();
    } else if (
      !leavingFullscreenRef.current &&
      (ownsFullscreenRef.current || pendingFullscreenRequestsRef.current > 0)
    ) {
      exitViewerFullscreen();
    } else {
      requestViewerFullscreen().catch(() => {});
    }
  }, [close, exitViewerFullscreen, requestViewerFullscreen]);

  useEffect(() => {
    const onFullscreenChange = () => {
      const active =
        document.fullscreenElement !== null &&
        document.fullscreenElement === rootRef.current;

      if (active) {
        if (!ownsFullscreenRef.current) return;
      } else {
        if (!ownsFullscreenRef.current && !leavingFullscreenRef.current) {
          return;
        }
        ownsFullscreenRef.current = false;
        leavingFullscreenRef.current = false;
        lastFullscreenExitRef.current = performance.now();
        if (pendingFullscreenRequestsRef.current === 0) releasePage();
        if (closeOnFullscreenExitRef.current) {
          flushSync(close);
          return;
        }
      }

      setIsFullscreenActive(active);
      setEnteringFullscreen(false);
    };

    document.addEventListener("fullscreenchange", onFullscreenChange);

    return () => {
      document.removeEventListener("fullscreenchange", onFullscreenChange);
    };
  }, [close, releasePage]);

  useEffect(() => {
    const root = rootRef.current;
    if (!root || openFadeDone) return undefined;

    const finishOpenFade = () => setOpenFadeDone(true);

    const onAnimationEnd = (event: AnimationEvent) => {
      if (event.target === root) finishOpenFade();
    };

    root.addEventListener("animationend", onAnimationEnd);
    const fallbackTimer = window.setTimeout(
      finishOpenFade,
      OPEN_FADE_MS + OPEN_FADE_FALLBACK_MARGIN_MS
    );

    return () => {
      root.removeEventListener("animationend", onAnimationEnd);
      window.clearTimeout(fallbackTimer);
    };
  }, [openFadeDone]);

  useEffect(() => {
    if (
      closeOnFullscreenExitRef.current &&
      !initialFullscreenRequestedRef.current
    ) {
      initialFullscreenRequestedRef.current = true;
      requestViewerFullscreen().catch(() => {
        if (ownsFullscreenRef.current) return;
        closeOnFullscreenExitRef.current = false;
        setEnteringFullscreen(false);
      });
    }
  }, [requestViewerFullscreen]);

  useEffect(() => {
    unmountedRef.current = false;
    if (pendingFullscreenRequestsRef.current > 0 || ownsFullscreenRef.current) {
      holdPage();
    }

    return () => {
      unmountedRef.current = true;
      queueMicrotask(() => {
        if (!unmountedRef.current) return;
        const needsExit =
          ownsFullscreenRef.current ||
          leavingFullscreenRef.current ||
          pendingFullscreenRequestsRef.current > 0;
        ownsFullscreenRef.current = false;
        if (needsExit) {
          void leaveFullscreen().finally(releasePage);
        } else {
          releasePage();
        }
      });
    };
  }, [holdPage, releasePage]);

  useEffect(() => {
    const previouslyFocused = document.activeElement as HTMLElement | null;
    rootRef.current?.focus({ preventScroll: true });

    return () => {
      previouslyFocused?.focus?.({ preventScroll: true });
    };
  }, []);

  useEffect(() => {
    const handleEscape = (video: GalleryVideoPlayerHandle | null) => {
      if (video?.dismissMenu()) return;

      if (ownsFullscreenRef.current) {
        if (closeOnFullscreenExitRef.current) {
          close();
        } else {
          exitViewerFullscreen();
        }
        return;
      }

      const recentlyExitedFullscreen =
        performance.now() - lastFullscreenExitRef.current <
        ESCAPE_AFTER_FULLSCREEN_EXIT_MS;
      if (!recentlyExitedFullscreen) close();
    };

    const onKeyDown = (event: KeyboardEvent) => {
      if (!isTopmostDialog(dialogRef.current)) return;
      if (trapFocus && event.key === "Tab" && rootRef.current) {
        event.preventDefault();
        event.stopPropagation();
        moveFocusWithinContainer(rootRef.current, event.shiftKey);
        return;
      }
      if (event.ctrlKey || event.metaKey || event.altKey) return;
      if (isEditableTarget(event.target)) return;
      if (isActivatingFocusedControl(event, rootRef.current)) return;

      const video = isVideo && item ? (getVideoHandle(item.id) ?? null) : null;

      const navigateOrSeek = (step: number): ShortcutResult => {
        if (!video || event.shiftKey) {
          navigate(index + step);
          return "quiet";
        }
        video.seekBy(step * SEEK_STEP_SECONDS);
        return "wake";
      };

      const navigateTo = (nextIndex: number): ShortcutResult => {
        navigate(nextIndex);
        return "quiet";
      };

      const withVideo =
        (action: (handle: GalleryVideoPlayerHandle) => void) =>
        (): ShortcutResult => {
          if (!video) return null;
          action(video);
          return "wake";
        };

      const seekOrNavigateTo = (ratio: number, fallbackIndex: number) =>
        video
          ? withVideo((handle) => handle.seekToRatio(ratio))()
          : navigateTo(fallbackIndex);

      const shortcuts: Record<string, () => ShortcutResult> = {
        Escape: () => {
          handleEscape(video);
          return "quiet";
        },
        f: () => {
          toggleFullscreen();
          return "quiet";
        },
        ArrowLeft: () => navigateOrSeek(-1),
        ArrowRight: () => navigateOrSeek(1),
        PageUp: () => navigateTo(index - 1),
        PageDown: () => navigateTo(index + 1),
        Home: () => seekOrNavigateTo(0, 0),
        End: () => seekOrNavigateTo(1, items.length - 1),
        ArrowUp: withVideo((handle) => handle.changeVolume(VOLUME_STEP)),
        ArrowDown: withVideo((handle) => handle.changeVolume(-VOLUME_STEP)),
        " ": withVideo((handle) => handle.togglePlay()),
        k: withVideo((handle) => handle.togglePlay()),
        m: withVideo((handle) => handle.toggleMute()),
      };

      const shortcut =
        shortcuts[normalizeShortcutKey(resolveMediaKey(event.key))];
      const result = shortcut?.() ?? null;
      if (!result) return;

      event.preventDefault();
      event.stopPropagation();
      if (result === "wake") wake();
    };

    const onTypingEscape = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || event.defaultPrevented) return;
      if (!isEditableTarget(event.target)) return;
      if (!rootRef.current?.contains(event.target as Node)) return;
      if (!isTopmostDialog(dialogRef.current)) return;
      event.preventDefault();
      handleEscape(null);
    };

    window.addEventListener("keydown", onKeyDown, true);
    window.addEventListener("keydown", onTypingEscape);

    return () => {
      window.removeEventListener("keydown", onKeyDown, true);
      window.removeEventListener("keydown", onTypingEscape);
    };
  }, [
    isVideo,
    item,
    index,
    items.length,
    trapFocus,
    getVideoHandle,
    navigate,
    close,
    exitViewerFullscreen,
    toggleFullscreen,
    wake,
  ]);

  useEffect(() => {
    const root = rootRef.current;
    if (!root) return undefined;

    const onWheel = (event: WheelEvent) => {
      if (isInsideScrollable(event.target)) return;
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
      if (shouldClose && !ownsFullscreenRef.current) close();
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

  useEffect(() => {
    const root = rootRef.current;
    if (!root) return undefined;

    const onPointerMove = (event: PointerEvent) => {
      pointerOverChromeRef.current =
        event.target instanceof Element &&
        event.target.closest("[data-gallery-chrome]") !== null;
      if (isPointerActivity(event)) wake();
    };

    const onPointerLeave = () => {
      pointerOverChromeRef.current = false;
      window.clearTimeout(idleTimerRef.current);
      setIdle(true);
    };

    root.addEventListener("pointermove", onPointerMove);
    root.addEventListener("pointerdown", wake);
    root.addEventListener("pointerleave", onPointerLeave);

    return () => {
      root.removeEventListener("pointermove", onPointerMove);
      root.removeEventListener("pointerdown", wake);
      root.removeEventListener("pointerleave", onPointerLeave);
    };
  }, [wake]);

  const activeVideoId = isVideo && item ? item.id : null;
  const borrowedVideoKey = layers
    .map(getLayerItem)
    .flatMap((layerItem) => (layerItem?.type === "video" ? [layerItem.id] : []))
    .join("|");

  useEffect(() => {
    onPresentationChange?.({
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
    if (!toggleFullscreenRef) return undefined;
    toggleFullscreenRef.current = toggleFullscreen;
    return () => {
      toggleFullscreenRef.current = null;
    };
  }, [toggleFullscreen, toggleFullscreenRef]);

  if (!item) return null;

  const showFilmstrip =
    allowFilmstrip && items.length > 1 && !(isFullscreen && isVideo);
  const caption = getCaption ? getCaption(item, { isSidebarOpen }) : item.alt;

  return (
    <dialog
      ref={dialogRef}
      open
      className="gallery-lightbox-dialog"
      data-hydra-dialog
      aria-modal="true"
      aria-label={item.alt}
    >
      <div
        ref={rootRef}
        className={cn("gallery-lightbox", {
          "gallery-lightbox--fullscreen": isFullscreen,
          "gallery-lightbox--chrome-hidden": chromeHidden,
          "gallery-lightbox--with-filmstrip": showFilmstrip,
          "gallery-lightbox--with-sidebar": isSidebarOpen,
          "gallery-lightbox--titlebar-offset": !isFullscreen && !isLinux,
          "gallery-lightbox--below-titlebar": !isFullscreen && isLinux,
        })}
        style={
          {
            "--layer-fade-duration": `${LAYER_FADE_MS}ms`,
            "--open-fade-duration": `${OPEN_FADE_MS}ms`,
          } as React.CSSProperties
        }
        tabIndex={-1}
      >
        <div className="gallery-lightbox__stage">
          {layers.map((layer, position) => {
            const layerItem = getLayerItem(layer);
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
                {layerItem.type === "video"
                  ? videoHosts.has(layerItem.id) && (
                      <GalleryVideoSlot
                        host={videoHosts.get(layerItem.id)!}
                        mode="borrow"
                      />
                    )
                  : renderLayerImage(layerItem, {
                      isFullscreen,
                      onReady: () => markLayerReady(layer.key),
                      onToggleFullscreen: toggleFullscreen,
                    })}
              </div>
            );
          })}
        </div>

        <div
          className="gallery-lightbox__top-bar gallery-lightbox__chrome"
          data-gallery-chrome
        >
          <div className="gallery-lightbox__heading">
            {showCounter && (
              <span className="gallery-lightbox__counter">
                {index + 1} / {items.length}
              </span>
            )}
            {caption && (
              <span className="gallery-lightbox__title">{caption}</span>
            )}
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

        {renderSidebar && (
          <div
            ref={sidebarRef}
            className="gallery-lightbox__sidebar"
            hidden={!isSidebarOpen}
            data-gallery-chrome
            data-gallery-scrollable
          >
            {renderSidebar(item, index)}
          </div>
        )}
      </div>
    </dialog>
  );
}

export function GalleryLightbox({
  visible,
  ...props
}: Readonly<GalleryLightboxProps>) {
  if (!visible) return null;

  return createPortal(<GalleryLightboxContent {...props} />, document.body);
}
