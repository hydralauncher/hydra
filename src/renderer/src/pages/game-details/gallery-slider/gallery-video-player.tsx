import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import Hls from "hls.js";
import cn from "classnames";
import { useTranslation } from "react-i18next";
import { CheckIcon } from "@primer/octicons-react";
import {
  CornersIn,
  CornersOut,
  GearSix,
  Pause,
  Play,
  SpeakerHigh,
  SpeakerLow,
  SpeakerX,
} from "@phosphor-icons/react";
import { useHlsVideo } from "@shared";
import type { GalleryMediaItem, GalleryVideoSource } from "./gallery-slider";
import { HLS_VIDEO_TYPE } from "./gallery-media-sources";
import { isPointerActivity } from "./gallery-shortcuts";
import { shouldPauseOnToggle } from "./gallery-playback";
import "./gallery-video-player.scss";

const AUTO_QUALITY = -1;
const DEFAULT_ASPECT_RATIO = 16 / 9;
const FLASH_DURATION_MS = 650;
const STORYBOARD_FRAMES = 50;
const STORYBOARD_FRAME_CENTER = 0.5;
const STORYBOARD_SEEK_TOLERANCE_SECONDS = 0.01;
const STORYBOARD_MAX_BUFFER_SECONDS = 2;
const STORYBOARD_MAX_MAX_BUFFER_SECONDS = 4;
const DEFAULT_UNMUTE_VOLUME = 0.5;
const SPEAKER_HIGH_VOLUME = 0.5;
const RESTORE_SEEK_TOLERANCE_SECONDS = 0.5;
const BUFFERED_RANGE_LOOKAHEAD_SECONDS = 0.5;
const STORYBOARD_FRAME_WIDTH = 400;
const STORYBOARD_SEEK_TIMEOUT_MS = 4000;
const VOLUME_STORAGE_KEY = "trailerVolume";
const MUTED_STORAGE_KEY = "trailerMuted";

export const SEEK_STEP_SECONDS = 5;

const DIRECTION_KEY_ALIASES: Record<string, string> = {
  w: "ArrowUp",
  a: "ArrowLeft",
  s: "ArrowDown",
  d: "ArrowRight",
};

export const resolveMediaKey = (key: string) =>
  DIRECTION_KEY_ALIASES[key.toLowerCase()] ?? key;
export const INLINE_IDLE_TIMEOUT_MS = 2500;
export const VIEWER_IDLE_TIMEOUT_MS = 2500;
export const FULLSCREEN_IDLE_TIMEOUT_MS = 500;
export const GALLERY_PAGE_TOOLTIP_ID = "gallery-page-tooltip";
export const GALLERY_VIEWER_TOOLTIP_ID = "gallery-viewer-tooltip";

type SeekDirection = "back" | "forward";

interface SeekIndicatorState {
  amount: number;
  presses: number;
  hiding: boolean;
  canceled: boolean;
}

type SeekIndicators = Partial<Record<SeekDirection, SeekIndicatorState>>;

interface VolumeIndicatorState {
  presses: number;
  hiding: boolean;
}

const SEEK_DIRECTIONS: SeekDirection[] = ["back", "forward"];

const hideSeekIndicators = (
  indicators: SeekIndicators,
  canceled: boolean
): SeekIndicators => {
  const next: SeekIndicators = {};
  SEEK_DIRECTIONS.forEach((direction) => {
    const indicator = indicators[direction];
    if (!indicator) return;
    next[direction] = indicator.hiding
      ? indicator
      : { ...indicator, hiding: true, canceled };
  });
  return next;
};

export interface GalleryPlaybackState {
  time: number;
  volume: number;
  muted: boolean;
  playing: boolean;
  hasPlayed: boolean;
}

export interface GalleryVideoPlayerHandle {
  getState: () => GalleryPlaybackState | null;
  restore: (state: GalleryPlaybackState) => void;
  play: () => void;
  pause: () => void;
  togglePlay: () => void;
  seekBy: (seconds: number) => void;
  seekToRatio: (ratio: number) => void;
  changeVolume: (delta: number) => void;
  toggleMute: () => void;
  dismissMenu: () => boolean;
  toggleQualityMenu: () => boolean;
  isQualityMenuOpen: () => boolean;
  moveQualityFocus: (delta: number) => void;
  selectFocusedQuality: () => void;
  getControlsState: () => { hidden: boolean; held: boolean };
}

interface GalleryVideoPlayerProps {
  item: GalleryMediaItem;
  variant: "inline" | "viewer";
  autoPlay?: boolean;
  loadOnDemand?: boolean;
  isFullscreen?: boolean;
  controlsHidden?: boolean;
  className?: string;
  onToggleFullscreen: () => void;
  onHoldChromeChange?: (hold: boolean) => void;
  interactive?: boolean;
  idleTimeoutMs?: number;
  indicatorTimeoutMs?: number;
}

interface QualityOption {
  id: number;
  label: string;
}

interface PendingRestore {
  time: number;
  play: boolean;
}

const clamp = (value: number, min = 0, max = 1) =>
  Math.min(max, Math.max(min, value));

const formatTime = (seconds: number) => {
  const total = Number.isFinite(seconds) ? Math.max(0, Math.floor(seconds)) : 0;
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const secs = String(total % 60).padStart(2, "0");

  return hours > 0
    ? `${hours}:${String(minutes).padStart(2, "0")}:${secs}`
    : `${minutes}:${secs}`;
};

const hasDuration = (value: number) => Number.isFinite(value) && value > 0;

const getIdleTimeout = (isInline: boolean, isFullscreen: boolean) => {
  if (isInline) return INLINE_IDLE_TIMEOUT_MS;
  if (isFullscreen) return FULLSCREEN_IDLE_TIMEOUT_MS;
  return VIEWER_IDLE_TIMEOUT_MS;
};

function VolumeIcon({
  level,
  size,
}: Readonly<{ level: number; size: number }>) {
  if (level === 0) return <SpeakerX size={size} weight="fill" />;
  if (level < SPEAKER_HIGH_VOLUME)
    return <SpeakerLow size={size} weight="fill" />;
  return <SpeakerHigh size={size} weight="fill" />;
}

const readStoredVolume = () => {
  const stored = localStorage.getItem(VOLUME_STORAGE_KEY);
  const volume = stored === null ? Number.NaN : Number(stored);
  return Number.isFinite(volume) ? clamp(volume) : 1;
};

const readStoredMuted = () => {
  const stored = localStorage.getItem(MUTED_STORAGE_KEY);
  return stored === null ? true : stored === "true";
};

const volumeListeners = new Set<() => void>();

const storeVolume = (volume: number, muted: boolean) => {
  if (readStoredVolume() === volume && readStoredMuted() === muted) return;
  localStorage.setItem(VOLUME_STORAGE_KEY, String(volume));
  localStorage.setItem(MUTED_STORAGE_KEY, String(muted));
  volumeListeners.forEach((listener) => listener());
};

const preventFocusOnClick = (event: React.MouseEvent) => event.preventDefault();

interface ChromeStateInput {
  isInline: boolean;
  started: boolean;
  loaded: boolean;
  waiting: boolean;
  paused: boolean;
  ended: boolean;
  hasPlayed: boolean;
  autoplayBlocked: boolean;
  qualityMenuOpen: boolean;
  scrubbing: boolean;
  adjustingVolume: boolean;
  hoveringProgress: boolean;
  inlineHovered: boolean;
  inlineKeyboardActive: boolean;
  inlineIdle: boolean;
  viewerControlsHidden: boolean;
}

const getChromeState = (input: ChromeStateInput) => {
  const showBigPlay =
    !input.scrubbing &&
    (!input.started ||
      (!input.isInline && input.ended) ||
      (input.paused && !input.hasPlayed && input.autoplayBlocked));

  const holdChrome =
    (input.paused && (input.hasPlayed || !input.isInline)) ||
    input.ended ||
    input.qualityMenuOpen ||
    input.scrubbing ||
    input.adjustingVolume ||
    input.hoveringProgress;

  const inlineInactive =
    (!input.inlineHovered && !input.inlineKeyboardActive) || input.inlineIdle;

  return {
    showBigPlay,
    showSpinner:
      input.started && !showBigPlay && (!input.loaded || input.waiting),
    holdChrome,
    controlsHidden: input.isInline
      ? !holdChrome && inlineInactive
      : input.viewerControlsHidden,
  };
};

const isIndicatorVisible = (
  indicator: { hiding: boolean } | null | undefined
) => !!indicator && !indicator.hiding;

function SeekIndicatorBadge({
  direction,
  indicator,
  onHidden,
}: Readonly<{
  direction: SeekDirection;
  indicator: SeekIndicatorState;
  onHidden: (direction: SeekDirection) => void;
}>) {
  return (
    <div
      className={cn(
        "gallery-video__seek-indicator",
        `gallery-video__seek-indicator--${direction}`,
        {
          "gallery-video__seek-indicator--hiding": indicator.hiding,
          "gallery-video__seek-indicator--canceled": indicator.canceled,
        }
      )}
      aria-hidden
      onAnimationEnd={(event) => {
        if (event.target === event.currentTarget && indicator.hiding) {
          onHidden(direction);
        }
      }}
    >
      <div
        key={`arrows-${indicator.presses}`}
        className="gallery-video__seek-arrows"
      >
        {[0, 1, 2].map((arrow) => (
          <Play key={arrow} size={11} weight="fill" />
        ))}
      </div>
      <span
        key={`amount-${indicator.amount}`}
        className="gallery-video__seek-amount"
      >
        {direction === "back" ? "-" : "+"}
        {indicator.amount}s
      </span>
    </div>
  );
}

function VolumeIndicatorBadge({
  indicator,
  level,
  onHidden,
}: Readonly<{
  indicator: VolumeIndicatorState;
  level: number;
  onHidden: () => void;
}>) {
  const percent = Math.round(level * 100);

  return (
    <div
      className={cn("gallery-video__volume-indicator", {
        "gallery-video__volume-indicator--hiding": indicator.hiding,
      })}
      aria-hidden
      onAnimationEnd={(event) => {
        if (event.target === event.currentTarget && indicator.hiding) {
          onHidden();
        }
      }}
    >
      <span
        key={`icon-${indicator.presses}`}
        className="gallery-video__volume-indicator-icon"
      >
        <VolumeIcon level={level} size={18} />
      </span>
      <span className="gallery-video__volume-indicator-track">
        <span
          className="gallery-video__volume-indicator-fill"
          style={{ transform: `scaleX(${level})` }}
        />
      </span>
      <span
        key={`value-${percent}`}
        className="gallery-video__volume-indicator-value"
      >
        {percent}%
      </span>
    </div>
  );
}

function PlaybackIcon({
  playing,
  size,
}: Readonly<{ playing: boolean; size: number }>) {
  return playing ? (
    <Pause size={size} weight="fill" />
  ) : (
    <Play size={size} weight="fill" />
  );
}

function FullscreenButton({
  isFullscreen,
  isInline,
  tooltipId,
  onClick,
}: Readonly<{
  isFullscreen: boolean;
  isInline: boolean;
  tooltipId: string;
  onClick: () => void;
}>) {
  const { t } = useTranslation("game_details");
  const label = isFullscreen ? t("exit_fullscreen") : t("fullscreen");

  return (
    <button
      type="button"
      className="gallery-video__button gallery-video__button--fullscreen"
      onClick={onClick}
      onMouseDown={preventFocusOnClick}
      aria-label={label}
      data-tooltip-id={tooltipId}
      data-tooltip-content={`${label} (F)`}
      data-tooltip-place="top"
    >
      {isFullscreen ? (
        <CornersIn size={34} weight="bold" />
      ) : (
        <CornersOut size={isInline ? 24 : 26} weight="bold" />
      )}
    </button>
  );
}

function VolumeControl({
  level,
  iconSize,
  tooltipId,
  slider,
  onToggleMute,
}: Readonly<{
  level: number;
  iconSize: number;
  tooltipId: string;
  slider: ReturnType<typeof usePointerRatio>;
  onToggleMute: () => void;
}>) {
  const { t } = useTranslation("game_details");
  const muteLabel = level === 0 ? t("unmute") : t("mute");

  return (
    <div
      className={cn("gallery-video__volume", {
        "gallery-video__volume--active": slider.dragging,
      })}
    >
      <button
        type="button"
        className="gallery-video__button"
        onClick={onToggleMute}
        onMouseDown={preventFocusOnClick}
        aria-label={muteLabel}
        data-tooltip-id={tooltipId}
        data-tooltip-content={`${muteLabel} (M)`}
        data-tooltip-place="top"
      >
        <VolumeIcon level={level} size={iconSize} />
      </button>

      <div
        ref={slider.ref}
        className="gallery-video__volume-slider"
        style={{ "--volume": level } as React.CSSProperties}
        role="slider"
        tabIndex={-1}
        aria-label={t("volume")}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={Math.round(level * 100)}
        {...slider.handlers}
      >
        <div className="gallery-video__volume-track">
          <div className="gallery-video__volume-fill" />
        </div>
        <div className="gallery-video__volume-thumb" />
      </div>
    </div>
  );
}

interface QualityControlProps {
  menuRef: React.RefObject<HTMLDivElement>;
  options: QualityOption[];
  selected: number;
  open: boolean;
  focusedIndex: number | null;
  iconSize: number;
  tooltipId: string;
  onToggle: () => void;
  onSelect: (id: number) => void;
}

function QualityControl({
  menuRef,
  options,
  selected,
  open,
  focusedIndex,
  iconSize,
  tooltipId,
  onToggle,
  onSelect,
}: Readonly<QualityControlProps>) {
  const { t } = useTranslation("game_details");

  return (
    <div className="gallery-video__quality" ref={menuRef}>
      <button
        type="button"
        className={cn(
          "gallery-video__button",
          "gallery-video__quality-button",
          {
            "gallery-video__quality-button--open": open,
          }
        )}
        onClick={onToggle}
        onMouseDown={preventFocusOnClick}
        aria-label={t("video_quality")}
        aria-haspopup="menu"
        aria-expanded={open}
        data-tooltip-id={tooltipId}
        data-tooltip-content={t("video_quality")}
        data-tooltip-place="top"
        data-tooltip-hidden={open}
      >
        <GearSix size={iconSize} weight="fill" />
      </button>

      {open && (
        <div className="gallery-video__quality-menu" role="menu">
          <span className="gallery-video__quality-title">
            {t("video_quality")}
          </span>
          {options.map((option, optionIndex) => {
            const isSelected = option.id === selected;
            return (
              <button
                key={option.id}
                type="button"
                role="menuitemradio"
                aria-checked={isSelected}
                className={cn("gallery-video__quality-option", {
                  "gallery-video__quality-option--selected": isSelected,
                  "gallery-video__quality-option--focused":
                    optionIndex === focusedIndex,
                })}
                onClick={() => onSelect(option.id)}
                onMouseDown={preventFocusOnClick}
              >
                {option.label}
                {isSelected && <CheckIcon size={16} />}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

function useSeekPreview(item: GalleryMediaItem, sources: GalleryVideoSource[]) {
  const sourceRef = useRef<HTMLVideoElement | null>(null);
  const [sourceElement, setSourceElement] = useState<HTMLVideoElement | null>(
    null
  );
  const setSourceRef = useCallback((element: HTMLVideoElement | null) => {
    sourceRef.current = element;
    setSourceElement(element);
  }, []);
  const displayRef = useRef<HTMLCanvasElement>(null);
  const framesRef = useRef<(HTMLCanvasElement | undefined)[]>([]);
  const skippedRef = useRef(new Set<number>());
  const requestedRef = useRef<number | null>(null);
  const capturingRef = useRef<number | null>(null);
  const cursorRef = useRef(0);
  const timeoutRef = useRef<number>();
  const [active, setActive] = useState(false);
  const [ready, setReady] = useState(false);

  const storyboard = useMemo(() => {
    const showFrame = (index: number) => {
      const frame = framesRef.current[index];
      const display = displayRef.current;
      if (!frame || !display) return;

      if (display.width !== frame.width || display.height !== frame.height) {
        display.width = frame.width;
        display.height = frame.height;
      }
      display.getContext("2d")?.drawImage(frame, 0, 0);
      setReady(true);
    };

    const showNearestFrame = (index: number) => {
      for (let distance = 0; distance < STORYBOARD_FRAMES; distance++) {
        if (framesRef.current[index - distance]) {
          showFrame(index - distance);
          return;
        }
        if (framesRef.current[index + distance]) {
          showFrame(index + distance);
          return;
        }
      }
    };

    const nextIndex = () => {
      const frames = framesRef.current;
      const requested = requestedRef.current;
      if (requested !== null && !frames[requested]) return requested;

      for (let step = 0; step < STORYBOARD_FRAMES; step++) {
        const index = (cursorRef.current + step) % STORYBOARD_FRAMES;
        if (!frames[index] && !skippedRef.current.has(index)) return index;
      }
      return null;
    };

    const capture = () => {
      const video = sourceRef.current;
      const index = capturingRef.current;
      if (!video || index === null) return;

      window.clearTimeout(timeoutRef.current);
      capturingRef.current = null;

      if (video.videoWidth && video.videoHeight) {
        const canvas = document.createElement("canvas");
        canvas.width = STORYBOARD_FRAME_WIDTH;
        canvas.height = Math.round(
          (STORYBOARD_FRAME_WIDTH * video.videoHeight) / video.videoWidth
        );
        canvas
          .getContext("2d")
          ?.drawImage(video, 0, 0, canvas.width, canvas.height);
        framesRef.current[index] = canvas;
        cursorRef.current = (index + 1) % STORYBOARD_FRAMES;

        if (requestedRef.current !== null) {
          showNearestFrame(requestedRef.current);
        }
      }

      pump();
    };

    const pump = () => {
      const video = sourceRef.current;
      if (!video || capturingRef.current !== null) return;
      if (video.readyState < HTMLMediaElement.HAVE_METADATA) return;
      if (!hasDuration(video.duration)) return;

      const index = nextIndex();
      if (index === null) return;

      capturingRef.current = index;
      timeoutRef.current = window.setTimeout(() => {
        skippedRef.current.add(index);
        capturingRef.current = null;
        if (requestedRef.current === index) requestedRef.current = null;
        pump();
      }, STORYBOARD_SEEK_TIMEOUT_MS);

      const target =
        ((index + STORYBOARD_FRAME_CENTER) / STORYBOARD_FRAMES) *
        video.duration;
      if (
        Math.abs(video.currentTime - target) <
          STORYBOARD_SEEK_TOLERANCE_SECONDS &&
        video.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA
      ) {
        capture();
        return;
      }
      video.currentTime = target;
    };

    const request = (ratio: number) => {
      const index = Math.min(
        STORYBOARD_FRAMES - 1,
        Math.max(0, Math.floor(ratio * STORYBOARD_FRAMES))
      );
      requestedRef.current = index;
      skippedRef.current.delete(index);
      showNearestFrame(index);
      pump();
    };

    const reset = () => {
      window.clearTimeout(timeoutRef.current);
      framesRef.current = [];
      skippedRef.current.clear();
      capturingRef.current = null;
      cursorRef.current = 0;
    };

    return { capture, pump, request, reset };
  }, []);

  useEffect(() => {
    const video = sourceElement;
    if (!active || !video) return undefined;

    if (
      item.videoType === HLS_VIDEO_TYPE &&
      item.videoSrc &&
      Hls.isSupported()
    ) {
      const hls = new Hls({
        enableWorker: true,
        maxBufferLength: STORYBOARD_MAX_BUFFER_SECONDS,
        maxMaxBufferLength: STORYBOARD_MAX_MAX_BUFFER_SECONDS,
      });

      hls.on(Hls.Events.MANIFEST_PARSED, () => {
        const lowest = hls.levels.reduce(
          (best, level, index) =>
            level.bitrate < hls.levels[best].bitrate ? index : best,
          0
        );
        hls.currentLevel = lowest;
      });

      hls.loadSource(item.videoSrc);
      hls.attachMedia(video);

      return () => {
        storyboard.reset();
        hls.destroy();
      };
    }

    const src = sources.at(-1)?.src ?? item.videoSrc;
    if (!src) return undefined;

    video.src = src;

    return () => {
      storyboard.reset();
      video.removeAttribute("src");
      video.load();
    };
  }, [
    active,
    sourceElement,
    item.videoSrc,
    item.videoType,
    sources,
    storyboard,
  ]);

  const preview = useCallback(
    (ratio: number) => {
      setActive(true);
      storyboard.request(ratio);
    },
    [storyboard]
  );

  const sourceHandlers = {
    onLoadedMetadata: storyboard.pump,
    onSeeked: storyboard.capture,
  };

  return {
    sourceRef: setSourceRef,
    displayRef,
    ready,
    preview,
    sourceHandlers,
  };
}

function usePointerRatio(
  onChange: (ratio: number) => void,
  onStart?: () => void,
  onEnd?: () => void
) {
  const ref = useRef<HTMLDivElement>(null);
  const [dragging, setDragging] = useState(false);

  const ratioFromEvent = useCallback((event: React.PointerEvent) => {
    const rect = ref.current?.getBoundingClientRect();
    if (!rect || rect.width === 0) return 0;
    return clamp((event.clientX - rect.left) / rect.width);
  }, []);

  const finish = (event: React.PointerEvent<HTMLDivElement>) => {
    if (!event.currentTarget.hasPointerCapture(event.pointerId)) return;
    event.currentTarget.releasePointerCapture(event.pointerId);
    setDragging(false);
    onEnd?.();
  };

  const handlers = {
    onPointerDown: (event: React.PointerEvent<HTMLDivElement>) => {
      if (event.button !== 0) return;
      event.preventDefault();
      event.currentTarget.setPointerCapture(event.pointerId);
      setDragging(true);
      onStart?.();
      onChange(ratioFromEvent(event));
    },
    onPointerMove: (event: React.PointerEvent<HTMLDivElement>) => {
      if (!event.currentTarget.hasPointerCapture(event.pointerId)) return;
      onChange(ratioFromEvent(event));
    },
    onPointerUp: finish,
    onPointerCancel: finish,
  };

  return { ref, dragging, handlers, ratioFromEvent };
}

export const GalleryVideoPlayer = forwardRef<
  GalleryVideoPlayerHandle,
  GalleryVideoPlayerProps
>(function GalleryVideoPlayer(
  {
    item,
    variant,
    autoPlay = true,
    loadOnDemand = false,
    isFullscreen = false,
    controlsHidden: viewerControlsHidden = false,
    className,
    onToggleFullscreen,
    onHoldChromeChange,
    interactive = true,
    idleTimeoutMs,
    indicatorTimeoutMs,
  },
  ref
) {
  const { t } = useTranslation("game_details");
  const isInline = variant === "inline";
  const videoRef = useRef<HTMLVideoElement>(null);
  const qualityMenuRef = useRef<HTMLDivElement>(null);
  const pendingRestoreRef = useRef<PendingRestore | null>({
    time: 0,
    play: autoPlay,
  });
  const resumeAfterScrubRef = useRef(false);
  const scrubRatioRef = useRef<number | null>(null);
  const inlineIdleTimerRef = useRef<number>();
  const controlsStateRef = useRef({ hidden: false, held: false });
  const lastViewerControlsHiddenRef = useRef(false);
  const wasInlineRef = useRef(variant === "inline");

  const isHls = item.videoType === HLS_VIDEO_TYPE;
  const sources = useMemo(() => item.sources ?? [], [item.sources]);

  const [started, setStarted] = useState(!loadOnDemand);
  const [sourceIndex, setSourceIndex] = useState(0);
  const [aspectRatio, setAspectRatio] = useState(DEFAULT_ASPECT_RATIO);
  const [loaded, setLoaded] = useState(false);
  const [waiting, setWaiting] = useState(false);
  const [paused, setPaused] = useState(true);
  const [ended, setEnded] = useState(false);
  const [hasPlayed, setHasPlayed] = useState(false);
  const [autoplayBlocked, setAutoplayBlocked] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [bufferedEnd, setBufferedEnd] = useState(0);
  const [volume, setVolume] = useState(readStoredVolume);
  const [muted, setMuted] = useState(readStoredMuted);
  const [hoverRatio, setHoverRatio] = useState<number | null>(null);
  const [seekIndicators, setSeekIndicators] = useState<SeekIndicators>({});
  const [seekPresses, setSeekPresses] = useState(0);
  const [volumeIndicator, setVolumeIndicator] =
    useState<VolumeIndicatorState | null>(null);
  const seekIndicatorTimerRef = useRef<number>();
  const flashTimerRef = useRef<number>();
  const indicatorTimeoutRef = useRef(indicatorTimeoutMs);
  indicatorTimeoutRef.current = indicatorTimeoutMs;
  const [flash, setFlash] = useState<{ key: number; playing: boolean } | null>(
    null
  );
  const [qualityMenuOpen, setQualityMenuOpen] = useState(false);
  const [qualityMenuFromController, setQualityMenuFromController] =
    useState(false);
  const [focusedQualityIndex, setFocusedQualityIndex] = useState(0);
  const qualityControlRef = useRef<{
    options: QualityOption[];
    selected: number;
    select: (id: number) => void;
  }>({ options: [], selected: 0, select: () => {} });
  const [hls, setHls] = useState<Hls | null>(null);
  const [hlsLevels, setHlsLevels] = useState<QualityOption[]>([]);
  const [selectedLevel, setSelectedLevel] = useState(AUTO_QUALITY);
  const [activeHeight, setActiveHeight] = useState<number | null>(null);
  const [inlineHovered, setInlineHovered] = useState(false);
  const [inlineIdle, setInlineIdle] = useState(false);
  const [inlineKeyboardActive, setInlineKeyboardActive] = useState(false);

  const currentSource = sources[sourceIndex];
  const videoSrc = currentSource?.src ?? item.videoSrc;

  useHlsVideo(videoRef, {
    videoSrc: isHls ? item.videoSrc : undefined,
    videoType: item.videoType,
    load: started,
    autoplay: false,
    onHlsInstance: setHls,
  });

  useLayoutEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    video.volume = readStoredVolume();
    video.muted = readStoredMuted();
  }, []);

  useEffect(() => {
    const syncVolume = () => {
      const video = videoRef.current;
      if (!video) return;
      const storedVolume = readStoredVolume();
      const storedMuted = readStoredMuted();
      if (video.volume !== storedVolume) video.volume = storedVolume;
      if (video.muted !== storedMuted) video.muted = storedMuted;
    };

    volumeListeners.add(syncVolume);

    return () => {
      volumeListeners.delete(syncVolume);
    };
  }, []);

  useEffect(() => {
    if (!hls) {
      setHlsLevels([]);
      setActiveHeight(null);
      return undefined;
    }

    const bestIndexByHeight = new Map<number, number>();
    hls.levels.forEach((level, index) => {
      if (!level.height) return;
      const current = bestIndexByHeight.get(level.height);
      if (
        current === undefined ||
        hls.levels[current].bitrate < level.bitrate
      ) {
        bestIndexByHeight.set(level.height, index);
      }
    });

    setHlsLevels(
      [...bestIndexByHeight.entries()]
        .sort(([a], [b]) => b - a)
        .map(([height, index]) => ({ id: index, label: `${height}p` }))
    );

    const onLevelSwitched = (_event: string, data: { level: number }) => {
      setActiveHeight(hls.levels[data.level]?.height ?? null);
    };

    hls.on(Hls.Events.LEVEL_SWITCHED, onLevelSwitched);

    return () => {
      hls.off(Hls.Events.LEVEL_SWITCHED, onLevelSwitched);
    };
  }, [hls]);

  useEffect(() => {
    return () => {
      window.clearTimeout(inlineIdleTimerRef.current);
      window.clearTimeout(seekIndicatorTimerRef.current);
      window.clearTimeout(flashTimerRef.current);
    };
  }, []);

  const showFlash = (playing: boolean) => {
    setFlash((current) => ({ key: (current?.key ?? 0) + 1, playing }));
    window.clearTimeout(flashTimerRef.current);
    flashTimerRef.current = window.setTimeout(
      () => setFlash(null),
      FLASH_DURATION_MS
    );
  };

  const play = useCallback(() => {
    videoRef.current
      ?.play()
      .then(() => setAutoplayBlocked(false))
      .catch(() => setAutoplayBlocked(true));
  }, []);

  const seekSlider = usePointerRatio(
    (ratio) => {
      scrubRatioRef.current = ratio;
      setHoverRatio(ratio);
      const video = videoRef.current;
      if (video && Number.isFinite(video.duration)) {
        video.currentTime = ratio * video.duration;
        setCurrentTime(video.currentTime);
      }
    },
    () => {
      const video = videoRef.current;
      resumeAfterScrubRef.current = !!video && !video.paused && !video.ended;
      video?.pause();
    },
    () => {
      scrubRatioRef.current = null;
      if (resumeAfterScrubRef.current) play();
    }
  );

  const progressRef = seekSlider.ref;

  const updatePlayedProgress = useCallback(() => {
    const video = videoRef.current;
    const progress = progressRef.current;
    if (!video || !progress) return;

    const ratio =
      scrubRatioRef.current ??
      (hasDuration(video.duration) ? video.currentTime / video.duration : 0);
    progress.style.setProperty("--played", String(clamp(ratio)));
  }, [progressRef]);

  const progressAnimating = (!paused && !ended) || seekSlider.dragging;

  useEffect(() => {
    updatePlayedProgress();
    if (!progressAnimating) return undefined;

    let frame = 0;
    const tick = () => {
      updatePlayedProgress();
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);

    return () => cancelAnimationFrame(frame);
  }, [
    interactive,
    progressAnimating,
    currentTime,
    duration,
    updatePlayedProgress,
  ]);

  const togglePlay = useCallback(() => {
    const video = videoRef.current;
    if (!video) return;

    if (!started) {
      pendingRestoreRef.current = { time: 0, play: true };
      setStarted(true);
      showFlash(true);
      return;
    }

    const pendingRestore = pendingRestoreRef.current;
    const pause = shouldPauseOnToggle({
      paused: video.paused,
      ended: video.ended,
      pendingPlay: pendingRestore?.play === true,
    });

    if (pause) {
      if (pendingRestore) {
        pendingRestoreRef.current = { ...pendingRestore, play: false };
      }
      video.pause();
      showFlash(false);
    } else {
      play();
      showFlash(true);
    }
  }, [play, started]);

  const seekTo = useCallback((time: number) => {
    const video = videoRef.current;
    if (!video || !Number.isFinite(video.duration)) return;
    video.currentTime = clamp(time, 0, video.duration);
    setCurrentTime(video.currentTime);
  }, []);

  const changeVolume = useCallback((delta: number) => {
    const video = videoRef.current;
    if (!video) return;

    const base = video.muted ? 0 : video.volume;
    const next = clamp(Math.round((base + delta) * 100) / 100);
    video.volume = next;
    video.muted = next === 0;
  }, []);

  const setVolumeRatio = useCallback((ratio: number) => {
    const video = videoRef.current;
    if (!video) return;
    video.volume = ratio;
    video.muted = ratio === 0;
  }, []);

  const toggleMute = useCallback(() => {
    const video = videoRef.current;
    if (!video) return;

    if (video.muted || video.volume === 0) {
      if (video.volume === 0) video.volume = DEFAULT_UNMUTE_VOLUME;
      video.muted = false;
    } else {
      video.muted = true;
    }
  }, []);

  const showVolumeIndicator = useCallback(() => {
    setVolumeIndicator((current) => ({
      presses: (current?.presses ?? 0) + 1,
      hiding: false,
    }));
    setSeekPresses((presses) => presses + 1);
    window.clearTimeout(seekIndicatorTimerRef.current);
    seekIndicatorTimerRef.current = window.setTimeout(() => {
      setSeekIndicators((current) => hideSeekIndicators(current, false));
      setVolumeIndicator((current) => current && { ...current, hiding: true });
    }, indicatorTimeoutRef.current ?? FULLSCREEN_IDLE_TIMEOUT_MS);
  }, []);

  useImperativeHandle(
    ref,
    () => ({
      getControlsState: () => controlsStateRef.current,
      getState: () => {
        const video = videoRef.current;
        if (!video) return null;
        return {
          time: video.currentTime,
          volume: video.volume,
          muted: video.muted,
          playing: !video.paused && !video.ended,
          hasPlayed,
        };
      },
      restore: (state) => {
        const video = videoRef.current;
        if (!video) return;

        if (!started) {
          if (!state.playing) return;
          pendingRestoreRef.current = { time: state.time, play: true };
          setStarted(true);
          return;
        }

        if (!loaded) {
          pendingRestoreRef.current = { time: state.time, play: state.playing };
          return;
        }

        if (
          Number.isFinite(video.duration) &&
          Math.abs(video.currentTime - state.time) >
            RESTORE_SEEK_TOLERANCE_SECONDS
        ) {
          video.currentTime = clamp(state.time, 0, video.duration);
        }
        if (state.playing) {
          play();
        } else {
          video.pause();
        }
      },
      play: () => {
        if (!started) {
          pendingRestoreRef.current = { time: 0, play: true };
          setStarted(true);
          return;
        }
        play();
      },
      pause: () => {
        if (pendingRestoreRef.current) {
          pendingRestoreRef.current = {
            ...pendingRestoreRef.current,
            play: false,
          };
        }
        videoRef.current?.pause();
      },
      togglePlay,
      seekBy: (seconds) => {
        const video = videoRef.current;
        if (!video || !Number.isFinite(video.duration)) return;
        seekTo(video.currentTime + seconds);

        const direction: SeekDirection = seconds < 0 ? "back" : "forward";
        const opposite: SeekDirection =
          direction === "back" ? "forward" : "back";
        setSeekIndicators((current) => {
          const same = current[direction];
          const other = current[opposite];
          return {
            [direction]: {
              amount:
                same && !same.hiding
                  ? same.amount + Math.abs(seconds)
                  : Math.abs(seconds),
              presses: (same?.presses ?? 0) + 1,
              hiding: false,
              canceled: false,
            },
            [opposite]:
              other && !other.hiding
                ? { ...other, hiding: true, canceled: true }
                : other,
          };
        });
        setSeekPresses((presses) => presses + 1);
        window.clearTimeout(seekIndicatorTimerRef.current);
        seekIndicatorTimerRef.current = window.setTimeout(() => {
          setSeekIndicators((current) => hideSeekIndicators(current, false));
          setVolumeIndicator(
            (current) => current && { ...current, hiding: true }
          );
        }, indicatorTimeoutRef.current ?? FULLSCREEN_IDLE_TIMEOUT_MS);

        if (isInline) {
          setInlineKeyboardActive(true);
          setInlineIdle(false);
          window.clearTimeout(inlineIdleTimerRef.current);
          inlineIdleTimerRef.current = window.setTimeout(() => {
            setInlineIdle(true);
            setInlineKeyboardActive(false);
          }, INLINE_IDLE_TIMEOUT_MS);
        }
      },
      seekToRatio: (ratio) => {
        const video = videoRef.current;
        if (video) seekTo(video.duration * clamp(ratio));
      },
      changeVolume: (delta) => {
        changeVolume(delta);
        showVolumeIndicator();
      },
      toggleMute: () => {
        toggleMute();
        showVolumeIndicator();
      },
      dismissMenu: () => {
        if (!qualityMenuOpen) return false;
        setQualityMenuOpen(false);
        return true;
      },
      toggleQualityMenu: () => {
        if (qualityMenuOpen) {
          setQualityMenuOpen(false);
          return true;
        }

        const { options, selected } = qualityControlRef.current;
        if (options.length === 0) return false;

        setFocusedQualityIndex(
          Math.max(
            0,
            options.findIndex((option) => option.id === selected)
          )
        );
        setQualityMenuFromController(true);
        setQualityMenuOpen(true);
        return true;
      },
      isQualityMenuOpen: () => qualityMenuOpen,
      moveQualityFocus: (delta) => {
        const { options } = qualityControlRef.current;
        if (options.length === 0) return;
        setFocusedQualityIndex((current) =>
          Math.min(options.length - 1, Math.max(0, current + delta))
        );
      },
      selectFocusedQuality: () => {
        const { options, select } = qualityControlRef.current;
        const option = options[focusedQualityIndex];
        if (option) select(option.id);
      },
    }),
    [
      isInline,
      hasPlayed,
      started,
      loaded,
      play,
      togglePlay,
      seekTo,
      changeVolume,
      toggleMute,
      showVolumeIndicator,
      qualityMenuOpen,
      focusedQualityIndex,
    ]
  );

  useEffect(() => {
    if (!qualityMenuOpen) return undefined;

    const onPointerDown = (event: PointerEvent) => {
      if (qualityMenuRef.current?.contains(event.target as Node)) return;
      setQualityMenuOpen(false);
    };

    window.addEventListener("pointerdown", onPointerDown, true);

    return () => {
      window.removeEventListener("pointerdown", onPointerDown, true);
    };
  }, [qualityMenuOpen]);

  const volumeSlider = usePointerRatio(setVolumeRatio);
  const seekPreview = useSeekPreview(item, sources);
  const [tooltipRatio, setTooltipRatio] = useState(0);
  const { preview } = seekPreview;

  useEffect(() => {
    if (hoverRatio === null || !hasDuration(duration)) return;
    setTooltipRatio(hoverRatio);
    preview(hoverRatio);
  }, [hoverRatio, duration, preview]);

  const updateBuffered = () => {
    const video = videoRef.current;
    if (!video) return;

    const { buffered } = video;
    for (let i = 0; i < buffered.length; i++) {
      if (
        buffered.start(i) <=
          video.currentTime + BUFFERED_RANGE_LOOKAHEAD_SECONDS &&
        buffered.end(i) >= video.currentTime
      ) {
        setBufferedEnd(buffered.end(i));
        return;
      }
    }
    setBufferedEnd(0);
  };

  const handleLoadedMetadata = () => {
    const video = videoRef.current;
    if (!video) return;

    if (video.videoWidth && video.videoHeight) {
      setAspectRatio(video.videoWidth / video.videoHeight);
    }

    setDuration(video.duration);
    setLoaded(true);

    const restore = pendingRestoreRef.current;
    pendingRestoreRef.current = null;

    if (!restore) return;
    if (restore.time > 0 && restore.time < video.duration) {
      video.currentTime = restore.time;
    }
    if (restore.play) play();
  };

  const handleSelectSource = (index: number) => {
    const video = videoRef.current;
    setQualityMenuOpen(false);
    if (index === sourceIndex || !video) return;

    pendingRestoreRef.current = {
      time: video.currentTime,
      play: !video.paused && !video.ended,
    };
    setLoaded(false);
    setSourceIndex(index);
  };

  const handleSelectLevel = (level: number) => {
    setQualityMenuOpen(false);
    if (!hls || level === selectedLevel) return;
    hls.currentLevel = level;
    setSelectedLevel(level);
  };

  const wakeInlineControls = (event?: React.PointerEvent) => {
    if (!isInline) return;
    if (event && !isPointerActivity(event.nativeEvent)) return;
    setInlineIdle(false);
    window.clearTimeout(inlineIdleTimerRef.current);
    if ((event?.target as Element | null)?.closest("[data-gallery-chrome]")) {
      return;
    }
    inlineIdleTimerRef.current = window.setTimeout(() => {
      setInlineIdle(true);
      setInlineKeyboardActive(false);
    }, INLINE_IDLE_TIMEOUT_MS);
  };

  const qualityOptions: QualityOption[] = useMemo(() => {
    if (hlsLevels.length > 1) {
      return [
        {
          id: AUTO_QUALITY,
          label:
            selectedLevel === AUTO_QUALITY && activeHeight !== null
              ? `${t("video_quality_auto")} (${activeHeight}p)`
              : t("video_quality_auto"),
        },
        ...hlsLevels,
      ];
    }

    if (sources.length > 1) {
      return sources.map((source, index) => ({
        id: index,
        label: source.label,
      }));
    }

    return [];
  }, [hlsLevels, activeHeight, selectedLevel, sources, t]);

  const selectedQuality = hlsLevels.length > 1 ? selectedLevel : sourceIndex;

  const selectQuality = (id: number) =>
    hlsLevels.length > 1 ? handleSelectLevel(id) : handleSelectSource(id);

  qualityControlRef.current = {
    options: qualityOptions,
    selected: selectedQuality,
    select: selectQuality,
  };
  const isPlaying = !paused && !ended;
  const playLabel = isPlaying ? t("pause_video") : t("play_video");
  const volumeLevel = muted ? 0 : volume;
  const iconSize = isFullscreen ? 26 : 20;
  const tooltipId = isInline
    ? GALLERY_PAGE_TOOLTIP_ID
    : GALLERY_VIEWER_TOOLTIP_ID;

  const { showBigPlay, showSpinner, holdChrome, controlsHidden } =
    getChromeState({
      isInline,
      started,
      loaded,
      waiting,
      paused,
      ended,
      hasPlayed,
      autoplayBlocked,
      qualityMenuOpen,
      scrubbing: seekSlider.dragging,
      adjustingVolume: volumeSlider.dragging,
      hoveringProgress: hoverRatio !== null,
      inlineHovered,
      inlineKeyboardActive,
      inlineIdle,
      viewerControlsHidden,
    });

  controlsStateRef.current = { hidden: controlsHidden, held: holdChrome };

  useLayoutEffect(() => {
    if (!isInline) lastViewerControlsHiddenRef.current = viewerControlsHidden;
  }, [isInline, viewerControlsHidden]);

  useLayoutEffect(() => {
    const wasInline = wasInlineRef.current;
    wasInlineRef.current = isInline;
    if (!isInline || wasInline) return;

    window.clearTimeout(inlineIdleTimerRef.current);
    if (lastViewerControlsHiddenRef.current) {
      setInlineIdle(true);
      setInlineKeyboardActive(false);
      return;
    }

    setInlineIdle(false);
    setInlineKeyboardActive(true);
    inlineIdleTimerRef.current = window.setTimeout(() => {
      setInlineIdle(true);
      setInlineKeyboardActive(false);
    }, INLINE_IDLE_TIMEOUT_MS);
  }, [isInline]);

  useEffect(() => {
    onHoldChromeChange?.(holdChrome);
  }, [holdChrome, onHoldChromeChange]);

  const hasSeekIndicator =
    SEEK_DIRECTIONS.some((direction) =>
      isIndicatorVisible(seekIndicators[direction])
    ) || isIndicatorVisible(volumeIndicator);
  const idleTimeout = idleTimeoutMs ?? getIdleTimeout(isInline, isFullscreen);
  const previousControlsHiddenRef = useRef(controlsHidden);

  const removeSeekIndicator = useCallback((direction: SeekDirection) => {
    setSeekIndicators((current) => {
      if (!current[direction]?.hiding) return current;
      const next = { ...current };
      delete next[direction];
      return next;
    });
  }, []);

  const removeVolumeIndicator = useCallback(() => {
    setVolumeIndicator((current) => (current?.hiding ? null : current));
  }, []);

  const placementRef = useRef({ variant, interactive });
  const scrubbingRef = useRef(false);
  scrubbingRef.current = seekSlider.dragging;

  useLayoutEffect(() => {
    const previous = placementRef.current;
    if (previous.variant === variant && previous.interactive === interactive) {
      return;
    }
    placementRef.current = { variant, interactive };

    window.clearTimeout(flashTimerRef.current);
    window.clearTimeout(seekIndicatorTimerRef.current);
    setFlash(null);
    setSeekIndicators((current) =>
      Object.keys(current).length > 0 ? {} : current
    );
    setVolumeIndicator(null);
    if (!scrubbingRef.current) setHoverRatio(null);
  }, [variant, interactive]);

  const hideSeekIndicator = useCallback(() => {
    setSeekIndicators((current) => hideSeekIndicators(current, false));
    setVolumeIndicator((current) =>
      current && !current.hiding ? { ...current, hiding: true } : current
    );
  }, []);

  useEffect(() => {
    const wasHidden = previousControlsHiddenRef.current;
    previousControlsHiddenRef.current = controlsHidden;
    if (controlsHidden && !wasHidden) hideSeekIndicator();
  }, [controlsHidden, hideSeekIndicator]);

  useEffect(() => {
    if (!holdChrome || !hasSeekIndicator) return undefined;
    const timer = window.setTimeout(hideSeekIndicator, idleTimeout);
    return () => window.clearTimeout(timer);
  }, [
    holdChrome,
    hasSeekIndicator,
    seekPresses,
    idleTimeout,
    hideSeekIndicator,
  ]);

  const displayedTime =
    seekSlider.dragging && hoverRatio !== null
      ? hoverRatio * duration
      : currentTime;

  return (
    <div
      className={cn("gallery-video", `gallery-video--${variant}`, className, {
        "gallery-video--controls-hidden": controlsHidden,
        "gallery-video--fullscreen": isFullscreen,
      })}
      style={{ "--media-aspect": aspectRatio } as React.CSSProperties}
      data-playing={isPlaying || undefined}
      onPointerEnter={(event) => {
        setInlineHovered(true);
        wakeInlineControls(event);
      }}
      onPointerMove={wakeInlineControls}
      onPointerLeave={() => setInlineHovered(false)}
    >
      <video
        ref={videoRef}
        className={cn("gallery-video__element", {
          "gallery-slider__media": isInline,
        })}
        poster={item.poster}
        src={isHls || !started ? undefined : videoSrc}
        preload={started ? "auto" : "none"}
        loop={isInline}
        playsInline
        tabIndex={-1}
        onLoadedMetadata={handleLoadedMetadata}
        onDurationChange={(e) => setDuration(e.currentTarget.duration)}
        onTimeUpdate={(e) => setCurrentTime(e.currentTarget.currentTime)}
        onProgress={updateBuffered}
        onSeeked={updateBuffered}
        onPlay={() => {
          setPaused(false);
          setEnded(false);
          setHasPlayed(true);
          setAutoplayBlocked(false);
        }}
        onPause={() => setPaused(true)}
        onEnded={() => setEnded(true)}
        onWaiting={() => setWaiting(true)}
        onPlaying={() => setWaiting(false)}
        onCanPlay={() => setWaiting(false)}
        onVolumeChange={(e) => {
          const video = e.currentTarget;
          setVolume(video.volume);
          setMuted(video.muted);
          storeVolume(video.volume, video.muted);
        }}
      >
        <track kind="captions" />
      </video>

      {showSpinner && <div className="gallery-video__spinner" aria-hidden />}

      {interactive && (
        <>
          <button
            type="button"
            className="gallery-video__surface"
            onClick={togglePlay}
            onDoubleClick={onToggleFullscreen}
            onMouseDown={preventFocusOnClick}
            aria-label={playLabel}
            tabIndex={-1}
          />

          {showBigPlay && (
            <button
              type="button"
              className="gallery-video__big-play"
              onClick={togglePlay}
              onMouseDown={preventFocusOnClick}
              aria-label={t("play_video")}
            >
              <Play size={30} weight="fill" />
            </button>
          )}

          {SEEK_DIRECTIONS.map((direction) => {
            const indicator = seekIndicators[direction];
            return indicator ? (
              <SeekIndicatorBadge
                key={direction}
                direction={direction}
                indicator={indicator}
                onHidden={removeSeekIndicator}
              />
            ) : null;
          })}

          {volumeIndicator && (
            <VolumeIndicatorBadge
              indicator={volumeIndicator}
              level={volumeLevel}
              onHidden={removeVolumeIndicator}
            />
          )}

          {flash && !showBigPlay && (
            <div
              key={flash.key}
              className="gallery-video__flash"
              aria-hidden
              onAnimationEnd={() => setFlash(null)}
            >
              <PlaybackIcon playing={!flash.playing} size={26} />
            </div>
          )}

          <div className="gallery-video__controls" data-gallery-chrome>
            <div
              ref={progressRef}
              className={cn("gallery-video__progress", {
                "gallery-video__progress--scrubbing": seekSlider.dragging,
              })}
              role="slider"
              tabIndex={-1}
              aria-label={t("seek_video")}
              aria-valuemin={0}
              aria-valuemax={Math.floor(duration) || 0}
              aria-valuenow={Math.floor(currentTime)}
              aria-valuetext={`${formatTime(currentTime)} / ${formatTime(duration)}`}
              {...seekSlider.handlers}
              onPointerMove={(event) => {
                setHoverRatio(seekSlider.ratioFromEvent(event));
                seekSlider.handlers.onPointerMove(event);
              }}
              onPointerLeave={() => {
                if (!seekSlider.dragging) setHoverRatio(null);
              }}
              onPointerUp={(event) => {
                seekSlider.handlers.onPointerUp(event);
                const rect = event.currentTarget.getBoundingClientRect();
                if (
                  event.clientY < rect.top ||
                  event.clientY > rect.bottom ||
                  event.clientX < rect.left ||
                  event.clientX > rect.right
                ) {
                  setHoverRatio(null);
                }
              }}
            >
              <div className="gallery-video__progress-track">
                <div
                  className="gallery-video__progress-buffered"
                  style={{
                    transform: `scaleX(${duration > 0 ? clamp(bufferedEnd / duration) : 0})`,
                  }}
                />
                {hoverRatio !== null && (
                  <div
                    className="gallery-video__progress-hover"
                    style={{ transform: `scaleX(${hoverRatio})` }}
                  />
                )}
                <div className="gallery-video__progress-played" />
              </div>
              <div className="gallery-video__progress-thumb" />
              <div
                className={cn("gallery-video__progress-tooltip", {
                  "gallery-video__progress-tooltip--visible":
                    hoverRatio !== null && duration > 0,
                })}
                style={
                  { "--tooltip-ratio": tooltipRatio } as React.CSSProperties
                }
              >
                <canvas
                  ref={seekPreview.displayRef}
                  className={cn("gallery-video__preview-frame", {
                    "gallery-video__preview-frame--ready": seekPreview.ready,
                  })}
                />
                <video
                  ref={seekPreview.sourceRef}
                  className="gallery-video__preview-source"
                  muted
                  playsInline
                  preload="auto"
                  tabIndex={-1}
                  {...seekPreview.sourceHandlers}
                >
                  <track kind="captions" />
                </video>
                <span className="gallery-video__preview-time">
                  {formatTime(tooltipRatio * duration)}
                </span>
              </div>
            </div>

            <div className="gallery-video__bar">
              <button
                type="button"
                className="gallery-video__button"
                onClick={togglePlay}
                onMouseDown={preventFocusOnClick}
                aria-label={playLabel}
                data-tooltip-id={tooltipId}
                data-tooltip-content={`${playLabel} (${t("keyboard_space")})`}
                data-tooltip-place="top"
              >
                <PlaybackIcon playing={isPlaying} size={iconSize} />
              </button>

              <VolumeControl
                level={volumeLevel}
                iconSize={iconSize}
                tooltipId={tooltipId}
                slider={volumeSlider}
                onToggleMute={toggleMute}
              />

              <span className="gallery-video__time">
                {formatTime(displayedTime)}
                <span className="gallery-video__time-separator">/</span>
                {formatTime(duration)}
              </span>

              <div className="gallery-video__spacer" />

              {qualityOptions.length > 0 && (
                <QualityControl
                  menuRef={qualityMenuRef}
                  options={qualityOptions}
                  selected={selectedQuality}
                  open={qualityMenuOpen}
                  focusedIndex={
                    qualityMenuFromController ? focusedQualityIndex : null
                  }
                  iconSize={iconSize}
                  tooltipId={tooltipId}
                  onToggle={() => {
                    setQualityMenuFromController(false);
                    setQualityMenuOpen((open) => !open);
                  }}
                  onSelect={selectQuality}
                />
              )}

              <FullscreenButton
                isFullscreen={isFullscreen}
                isInline={isInline}
                tooltipId={tooltipId}
                onClick={onToggleFullscreen}
              />
            </div>
          </div>
        </>
      )}
    </div>
  );
});
