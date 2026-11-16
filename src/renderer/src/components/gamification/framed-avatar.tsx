import { useEffect, useRef, useState } from "react";
import cn from "classnames";
import { Avatar } from "../avatar/avatar";
import { prefersReducedMotion } from "./gamification-colors";
import type { FrameAsset } from "@types";
import "./framed-avatar.scss";

// Sample avatar frame: the prototype's "Aurora" (v4.2.0). The shop shows it on
// every item until the real frame sets exist.
const TAU = Math.PI * 2;
const PERIOD_S = 6;
const FRAME_MS = 1000 / 30;
const STILL_PHASE = 0.35 / PERIOD_S;
const SEGMENTS = 260;
const AURORA_PALETTE: readonly (readonly [number, number, number])[] = [
  [60, 255, 170],
  [70, 170, 255],
  [180, 100, 255],
];
// The avatar takes 72% of the canvas; the frame draws in the margin around it.
const AVATAR_SHARE = 0.72;
const MAX_PIXEL_RATIO = 2;
const REDUCED_MOTION_QUERY = "(prefers-reduced-motion: reduce)";

// Follows the OS setting live, so frames stop animating as soon as it is turned on.
function useReducedMotion() {
  const [isReduced, setIsReduced] = useState(prefersReducedMotion);
  useEffect(() => {
    const query = window.matchMedia(REDUCED_MOTION_QUERY);
    const onChange = () => setIsReduced(query.matches);
    query.addEventListener("change", onChange);
    return () => query.removeEventListener("change", onChange);
  }, []);
  return isReduced;
}

interface Geometry {
  size: number;
  x: number;
  y: number;
  side: number;
  radius: number;
}

const rgba = (color: readonly number[], alpha: number) =>
  `rgba(${color[0]},${color[1]},${color[2]},${Math.max(0, Math.min(1, alpha)).toFixed(3)})`;

const geometry = (size: number): Geometry => {
  const margin = size * 0.14;
  const side = size - 2 * margin;
  return { size, x: margin, y: margin, side, radius: side * 0.045 };
};

const roundedBox = (
  context: CanvasRenderingContext2D,
  g: Geometry,
  offset: number
) => {
  context.beginPath();
  context.roundRect(
    g.x - offset,
    g.y - offset,
    g.side + 2 * offset,
    g.side + 2 * offset,
    Math.max(0, g.radius + offset)
  );
};

/** Point at `u` (0-1, clockwise from the top-left) on the box outline grown by `offset`. */
const pointOnBox = (g: Geometry, u: number, offset: number) => {
  const x = g.x - offset;
  const y = g.y - offset;
  const width = g.side + 2 * offset;
  const radius = Math.max(0.0001, g.radius + offset);
  const straight = width - 2 * radius;
  const corner = (Math.PI / 2) * radius;
  let length = (((u % 1) + 1) % 1) * (4 * straight + 4 * corner);
  const starts = [
    [x + radius, y, 1, 0],
    [x + width, y + radius, 0, 1],
    [x + width - radius, y + width, -1, 0],
    [x, y + width - radius, 0, -1],
  ];
  const centers = [
    [x + width - radius, y + radius],
    [x + width - radius, y + width - radius],
    [x + radius, y + width - radius],
    [x + radius, y + radius],
  ];

  for (let side = 0; side < 4; side++) {
    if (length <= straight) {
      const [startX, startY, dx, dy] = starts[side];
      return { x: startX + dx * length, y: startY + dy * length };
    }
    length -= straight;
    if (length <= corner || side === 3) {
      const angle =
        -Math.PI / 2 + (side * Math.PI) / 2 + Math.min(length, corner) / radius;
      return {
        x: centers[side][0] + radius * Math.cos(angle),
        y: centers[side][1] + radius * Math.sin(angle),
      };
    }
    length -= corner;
  }
  return { x, y };
};

/** One frame of the Aurora at `phase` (0-1 over a 6 s loop). */
const drawAurora = (
  context: CanvasRenderingContext2D,
  size: number,
  phase: number
) => {
  const g = geometry(size);
  context.clearRect(0, 0, size, size);
  context.save();
  context.globalCompositeOperation = "lighter";
  context.lineCap = "round";

  AURORA_PALETTE.forEach((color, band) => {
    for (const [width, alpha] of [
      [0.034, 0.1],
      [0.012, 0.4],
    ]) {
      let previous: { x: number; y: number } | null = null;
      for (let index = 0; index <= SEGMENTS; index++) {
        const u = index / SEGMENTS;
        const offset =
          size *
          (0.02 +
            0.03 * (0.5 + 0.5 * Math.sin(TAU * (u * 3 + phase + band * 0.33))));
        const point = pointOnBox(g, u, offset);
        if (previous) {
          const glow =
            alpha *
            (0.25 +
              0.75 *
                Math.pow(
                  0.5 + 0.5 * Math.sin(TAU * (u * 2 - phase + band * 0.4)),
                  2
                ));
          context.strokeStyle = rgba(color, glow);
          context.lineWidth = size * width;
          context.beginPath();
          context.moveTo(previous.x, previous.y);
          context.lineTo(point.x, point.y);
          context.stroke();
        }
        previous = point;
      }
    }
  });
  context.restore();

  context.strokeStyle = "rgba(235, 255, 250, 0.45)";
  context.lineWidth = size * 0.003;
  roundedBox(context, g, size * 0.004);
  context.stroke();

  // Keep the avatar itself clear.
  context.save();
  context.globalCompositeOperation = "destination-out";
  roundedBox(context, g, 0);
  context.fill();
  context.restore();
};

export interface FramedAvatarProps {
  size: number;
  src?: string | null;
  alt?: string;
  /** Hides the photo and shows only the frame, as in the shop cards. */
  isFrameOnly?: boolean;
  /** Draws no frame (the "no frame" state). */
  isBare?: boolean;
  /** The real frame to draw; without it the sample frame is drawn. */
  frame?: FrameAsset | null;
  className?: string;
}

/**
 * An animated frame that only plays while on screen. The shop can hold dozens of
 * these at once; decoding the ones scrolled away is what makes it stutter.
 */
function FrameVideo({
  src,
  style,
  onError,
}: Readonly<{
  src: string;
  style: { width: number; height: number };
  onError: () => void;
}>) {
  const videoRef = useRef<HTMLVideoElement>(null);

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;

    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          video.play().catch(() => undefined);
        } else {
          video.pause();
        }
      },
      { rootMargin: "100px" }
    );
    observer.observe(video);
    return () => observer.disconnect();
  }, [src]);

  return (
    <video
      ref={videoRef}
      src={src}
      className="framed-avatar__frame"
      style={style}
      loop
      muted
      playsInline
      // Loads the first frame up front, so a paused frame never shows an empty box.
      preload="auto"
      aria-hidden="true"
      onError={onError}
    />
  );
}

export function FramedAvatar({
  size,
  src,
  alt,
  isFrameOnly = false,
  isBare = false,
  frame,
  className,
}: Readonly<FramedAvatarProps>) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const canvasSize = Math.round(size / AVATAR_SHARE);
  const isReducedMotion = useReducedMotion();

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || isBare || frame) return;

    const pixelRatio = Math.min(MAX_PIXEL_RATIO, window.devicePixelRatio || 1);
    const pixels = Math.round(canvasSize * pixelRatio);
    canvas.width = pixels;
    canvas.height = pixels;
    const context = canvas.getContext("2d");
    if (!context) return;

    if (isReducedMotion) {
      drawAurora(context, pixels, STILL_PHASE);
      return;
    }

    // Animate only while on screen; a grid of frames is costly otherwise.
    let animationFrame = 0;
    let lastDraw = 0;
    let isVisible = false;
    const tick = (now: number) => {
      if (now - lastDraw >= FRAME_MS) {
        lastDraw = now;
        drawAurora(context, pixels, (now / 1000 / PERIOD_S) % 1);
      }
      animationFrame = requestAnimationFrame(tick);
    };
    const observer = new IntersectionObserver(([entry]) => {
      if (entry.isIntersecting && !isVisible) {
        isVisible = true;
        animationFrame = requestAnimationFrame(tick);
      } else if (!entry.isIntersecting && isVisible) {
        isVisible = false;
        cancelAnimationFrame(animationFrame);
      }
    });
    observer.observe(canvas);

    return () => {
      observer.disconnect();
      cancelAnimationFrame(animationFrame);
    };
  }, [canvasSize, isBare, frame, isReducedMotion]);

  const [failedFrameUrl, setFailedFrameUrl] = useState<string | null>(null);
  const showsFrameAsset = !isBare && frame && failedFrameUrl !== frame.assetUrl;
  const frameStyle = { width: canvasSize, height: canvasSize };

  return (
    <span
      className={cn(
        "framed-avatar",
        { "framed-avatar--frame-only": isFrameOnly },
        className
      )}
      style={{ width: size, height: size }}
    >
      <Avatar size={size} src={src} alt={alt} />
      {showsFrameAsset &&
        (frame.assetType === "VIDEO" ? (
          <FrameVideo
            key={frame.assetUrl}
            src={frame.assetUrl}
            style={frameStyle}
            onError={() => setFailedFrameUrl(frame.assetUrl)}
          />
        ) : (
          <img
            key={frame.assetUrl}
            src={frame.assetUrl}
            className="framed-avatar__frame"
            style={frameStyle}
            alt=""
            aria-hidden="true"
            onError={() => setFailedFrameUrl(frame.assetUrl)}
          />
        ))}
      {!isBare && !frame && (
        <canvas
          ref={canvasRef}
          className="framed-avatar__frame"
          style={{ width: canvasSize, height: canvasSize }}
          aria-hidden="true"
        />
      )}
    </span>
  );
}
