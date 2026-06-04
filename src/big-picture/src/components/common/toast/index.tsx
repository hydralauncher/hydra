import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties,
} from "react";
import confetti from "canvas-confetti";
import { DownloadSimpleIcon, GearIcon, XIcon } from "@phosphor-icons/react";
import { useTranslation } from "react-i18next";
import cn from "classnames";
import { AnimatePresence, motion } from "framer-motion";
import { Button } from "../button";
import {
  type BigPictureToastAction,
  type BigPictureToastFallbackVisual,
  useBigPictureToastStore,
} from "../../../stores";

import "./styles.scss";

export interface BigPictureToastCardProps {
  title: string;
  message?: string;
  imageUrl?: string;
  color?: string;
  fallbackVisual?: BigPictureToastFallbackVisual;
  action?: BigPictureToastAction;
  progress?: number;
  onClose?: () => void;
  closeOnAction?: boolean;
  announce?: boolean;
}

interface BigPictureToastProps extends BigPictureToastCardProps {
  visible: boolean;
  duration: number;
  version: number;
  onClose: (version?: number) => void;
}

const INITIAL_PROGRESS = 100;
const hydraIconUrl = new URL("../../../assets/hydra-icon.svg", import.meta.url)
  .href;
const DEFAULT_FALLBACK_VISUAL: BigPictureToastFallbackVisual = "hydra";

function fireToastConfetti(
  fire: ReturnType<typeof confetti.create> | null | undefined,
  toastElement: HTMLElement | null | undefined
) {
  if (!fire || !toastElement) return;

  const rect = toastElement.getBoundingClientRect();
  const viewportWidth = globalThis.window.innerWidth;
  const viewportHeight = globalThis.window.innerHeight;
  const centerX = (rect.left + rect.width / 2) / viewportWidth;
  const launchY = (rect.top + rect.height * 0.2) / viewportHeight;

  const baseOptions = {
    ticks: 220,
    gravity: 1.15,
    drift: 0,
    scalar: 1.02,
    zIndex: 60,
  } as const;

  void fire({
    ...baseOptions,
    particleCount: 34,
    spread: 68,
    startVelocity: 40,
    angle: 90,
    origin: { x: centerX, y: launchY },
  });

  globalThis.window.setTimeout(() => {
    void fire({
      ...baseOptions,
      particleCount: 24,
      spread: 84,
      startVelocity: 32,
      angle: 90,
      origin: {
        x: centerX,
        y: launchY + (rect.height * 0.02) / viewportHeight,
      },
    });
  }, 90);
}

function getToastStyle(color?: string): CSSProperties | undefined {
  if (!color) return undefined;

  return {
    backgroundImage: `radial-gradient(circle at left top, color-mix(in srgb, ${color} 10%, transparent) 0%, color-mix(in srgb, ${color} 6.5%, transparent) 36%, color-mix(in srgb, ${color} 3%, transparent) 56%, transparent 75%)`,
  } satisfies CSSProperties;
}

export function BigPictureToastCard({
  title,
  message,
  imageUrl,
  color,
  fallbackVisual = DEFAULT_FALLBACK_VISUAL,
  action,
  progress = INITIAL_PROGRESS,
  onClose,
  closeOnAction = true,
  announce = true,
}: Readonly<BigPictureToastCardProps>) {
  const { t } = useTranslation();
  const [imageFailed, setImageFailed] = useState(false);

  useEffect(() => {
    setImageFailed(false);
  }, [imageUrl]);

  const resolvedImageUrl = imageFailed ? undefined : imageUrl;
  const hasAccent = Boolean(color);
  const toastStyle = getToastStyle(color);

  const fallbackIcon =
    fallbackVisual === "settings" ? (
      <GearIcon
        size={32}
        weight="regular"
        className="big-picture-toast__fallback-symbol"
      />
    ) : fallbackVisual === "downloads" ? (
      <DownloadSimpleIcon
        size={32}
        weight="regular"
        className="big-picture-toast__fallback-symbol"
      />
    ) : (
      <img
        src={hydraIconUrl}
        alt=""
        className="big-picture-toast__fallback-image"
      />
    );

  return (
    <div
      className={cn("big-picture-toast", {
        "big-picture-toast--accented": hasAccent,
        "big-picture-toast--with-action": Boolean(action),
      })}
      style={toastStyle}
      role={announce ? "status" : undefined}
      aria-live={announce ? "polite" : undefined}
    >
      <div className="big-picture-toast__content">
        <div className="big-picture-toast__media" aria-hidden="true">
          {resolvedImageUrl ? (
            <img
              src={resolvedImageUrl}
              alt=""
              className="big-picture-toast__media-image"
              onError={() => setImageFailed(true)}
            />
          ) : (
            <div className="big-picture-toast__fallback-icon">
              {fallbackIcon}
            </div>
          )}
        </div>

        <div className="big-picture-toast__divider" aria-hidden="true" />

        <div className="big-picture-toast__text">
          <span className="big-picture-toast__title">{title}</span>
          {message ? (
            <p className="big-picture-toast__description">{message}</p>
          ) : null}
        </div>

        {action ? (
          <Button
            variant="secondary"
            size="medium"
            className="big-picture-toast__action"
            focusable={false}
            tabIndex={-1}
            onClick={() => {
              void Promise.resolve(action.onClick());
              if (closeOnAction) onClose?.();
            }}
          >
            {action.label}
          </Button>
        ) : null}

        <button
          type="button"
          className="big-picture-toast__close"
          onClick={onClose}
          aria-label={t("catalogue.close", { defaultValue: "Close" })}
          tabIndex={-1}
        >
          <XIcon size={18} />
        </button>
      </div>

      <div className="big-picture-toast__progress" aria-hidden="true">
        <div
          className="big-picture-toast__progress-fill"
          style={{ transform: `scaleX(${progress / 100})` }}
        />
      </div>
    </div>
  );
}

function BigPictureToast({
  visible,
  title,
  message,
  imageUrl,
  color,
  fallbackVisual,
  action,
  duration,
  version,
  onClose,
}: Readonly<BigPictureToastProps>) {
  const [progress, setProgress] = useState(INITIAL_PROGRESS);

  const progressAnimation = useRef(-1);

  const closeCurrentToast = useCallback(() => {
    onClose(version);
  }, [onClose, version]);

  useLayoutEffect(() => {
    if (!visible) return;

    setProgress(INITIAL_PROGRESS);
    const zero = performance.now();
    progressAnimation.current = requestAnimationFrame(
      function animateProgress(time) {
        const elapsed = time - zero;
        const progress = Math.min(elapsed / duration, 1);
        const currentValue =
          INITIAL_PROGRESS + (0 - INITIAL_PROGRESS) * progress;

        setProgress(currentValue);

        if (progress < 1) {
          progressAnimation.current = requestAnimationFrame(animateProgress);
        } else {
          cancelAnimationFrame(progressAnimation.current);
          closeCurrentToast();
        }
      }
    );

    return () => {
      setProgress(INITIAL_PROGRESS);
      cancelAnimationFrame(progressAnimation.current);
    };
  }, [closeCurrentToast, duration, visible]);

  if (!visible) return null;

  return (
    <motion.div
      initial={{ opacity: 0, y: 18, scale: 0.96 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      exit={{ opacity: 0, y: 10, scale: 0.985 }}
      transition={{ duration: 0.26, ease: [0.22, 1, 0.36, 1] }}
    >
      <BigPictureToastCard
        title={title}
        message={message}
        imageUrl={imageUrl}
        color={color}
        fallbackVisual={fallbackVisual}
        action={action}
        progress={progress}
        onClose={closeCurrentToast}
      />
    </motion.div>
  );
}

export function BigPictureToastHost() {
  const visible = useBigPictureToastStore((state) => state.visible);
  const title = useBigPictureToastStore((state) => state.title);
  const message = useBigPictureToastStore((state) => state.message);
  const imageUrl = useBigPictureToastStore((state) => state.imageUrl);
  const color = useBigPictureToastStore((state) => state.color);
  const fallbackVisual = useBigPictureToastStore(
    (state) => state.fallbackVisual
  );
  const celebration = useBigPictureToastStore((state) => state.celebration);
  const action = useBigPictureToastStore((state) => state.action);
  const duration = useBigPictureToastStore((state) => state.duration);
  const version = useBigPictureToastStore((state) => state.version);
  const closeToast = useBigPictureToastStore((state) => state.closeToast);
  const confettiCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const toastContainerRef = useRef<HTMLDivElement | null>(null);
  const confettiInstanceRef = useRef<ReturnType<typeof confetti.create> | null>(
    null
  );

  useEffect(() => {
    const canvas = confettiCanvasRef.current;
    if (!canvas || confettiInstanceRef.current) return;

    confettiInstanceRef.current = confetti.create(canvas, {
      resize: true,
      useWorker: false,
      disableForReducedMotion: true,
    });

    return () => {
      confettiInstanceRef.current?.reset();
      confettiInstanceRef.current = null;
    };
  }, []);

  useEffect(() => {
    if (!visible || celebration !== "confetti") return;

    fireToastConfetti(confettiInstanceRef.current, toastContainerRef.current);
  }, [celebration, version, visible]);

  return (
    <div className="big-picture-toast-host" aria-hidden={!visible}>
      <canvas
        ref={confettiCanvasRef}
        className="big-picture-toast-host__confetti-canvas"
        aria-hidden="true"
      />

      <div ref={toastContainerRef} className="big-picture-toast-host__toast">
        <AnimatePresence mode="wait">
          {visible ? (
            <BigPictureToast
              key={version}
              visible={visible}
              title={title}
              message={message}
              imageUrl={imageUrl}
              color={color}
              fallbackVisual={fallbackVisual}
              action={action}
              duration={duration}
              version={version}
              onClose={closeToast}
            />
          ) : null}
        </AnimatePresence>
      </div>
    </div>
  );
}
