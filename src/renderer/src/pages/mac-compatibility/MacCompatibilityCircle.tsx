import { useCallback, useEffect, useRef } from "react";
import type {
  CSSProperties,
  KeyboardEvent as ReactKeyboardEvent,
  PointerEvent as ReactPointerEvent,
} from "react";
import cn from "classnames";

import HydraIcon from "@renderer/assets/icons/hydra.svg?url";

import "./MacCompatibilityCircle.scss";

export type MacCompatibilityStatus =
  | "ready"
  | "needs-setup"
  | "needs-fix"
  | "not-compatible"
  | "unknown";

export interface MacCompatibilityCircleProps {
  status?: MacCompatibilityStatus;
  /** Ring fill, 0 to 1. Defaults to a value implied by the status. */
  progress?: number;
  /** Diameter in pixels. */
  size?: number;
  /** Shows the spinning "working" state. */
  busy?: boolean;
  /** Fired on click, tap, Enter or Space (not fired after a drag). */
  onActivate?: () => void;
  className?: string;
}

interface StatusMeta {
  label: string;
  description: string;
  defaultProgress: number;
}

const STATUS_META: Record<MacCompatibilityStatus, StatusMeta> = {
  ready: {
    label: "Ready",
    description: "This game should work well on your Mac.",
    defaultProgress: 1,
  },
  "needs-setup": {
    label: "Needs setup",
    description: "Hydra can probably make this work.",
    defaultProgress: 0.75,
  },
  "needs-fix": {
    label: "Needs fix",
    description: "Something needs to be repaired or configured.",
    defaultProgress: 0.35,
  },
  "not-compatible": {
    label: "Not compatible",
    description: "Hydra knows there is currently a problem.",
    defaultProgress: 0.12,
  },
  unknown: {
    label: "Not checked yet",
    description: "Drag the circle or tap it to run a compatibility check.",
    defaultProgress: 0,
  },
};

/** Maximum distance the circle can travel from its resting position. */
const MAX_DRAG = 46;
/** Maximum tilt, in degrees, at full drag distance. */
const MAX_TILT = 14;

const SPRING_STIFFNESS = 0.16;
const SPRING_DAMPING = 0.76;
const CLICK_SLOP = 6;

const clamp = (value: number, min: number, max: number) =>
  Math.min(Math.max(value, min), max);

/** Soft, bounded resistance so the circle feels elastic instead of rigid. */
const rubberBand = (delta: number) => MAX_DRAG * Math.tanh(delta / MAX_DRAG);

export function MacCompatibilityCircle({
  status = "unknown",
  progress,
  size = 208,
  busy = false,
  onActivate,
  className,
}: MacCompatibilityCircleProps) {
  const elementRef = useRef<HTMLDivElement | null>(null);
  const frameRef = useRef<number | null>(null);
  const positionRef = useRef({ x: 0, y: 0 });
  const velocityRef = useRef({ x: 0, y: 0 });
  const originRef = useRef({ x: 0, y: 0 });
  const draggingRef = useRef(false);
  const movedRef = useRef(0);

  const meta = STATUS_META[status];
  const ringProgress = clamp(progress ?? meta.defaultProgress, 0, 1);

  const paint = useCallback(() => {
    const element = elementRef.current;
    if (!element) return;

    const { x, y } = positionRef.current;

    element.style.setProperty("--drag-x", `${x.toFixed(2)}px`);
    element.style.setProperty("--drag-y", `${y.toFixed(2)}px`);
    element.style.setProperty(
      "--tilt-x",
      `${((-y / MAX_DRAG) * MAX_TILT).toFixed(2)}deg`
    );
    element.style.setProperty(
      "--tilt-y",
      `${((x / MAX_DRAG) * MAX_TILT).toFixed(2)}deg`
    );
    element.style.setProperty(
      "--drag-amount",
      (Math.hypot(x, y) / MAX_DRAG).toFixed(3)
    );
  }, []);

  const stopSpring = useCallback(() => {
    if (frameRef.current !== null) {
      cancelAnimationFrame(frameRef.current);
      frameRef.current = null;
    }
  }, []);

  const startSpring = useCallback(() => {
    stopSpring();

    const step = () => {
      const position = positionRef.current;
      const velocity = velocityRef.current;

      velocity.x = (velocity.x - position.x * SPRING_STIFFNESS) * SPRING_DAMPING;
      velocity.y = (velocity.y - position.y * SPRING_STIFFNESS) * SPRING_DAMPING;

      position.x += velocity.x;
      position.y += velocity.y;

      const settled =
        Math.hypot(position.x, position.y) < 0.25 &&
        Math.hypot(velocity.x, velocity.y) < 0.25;

      if (settled) {
        position.x = 0;
        position.y = 0;
        velocity.x = 0;
        velocity.y = 0;
        paint();
        frameRef.current = null;
        return;
      }

      paint();
      frameRef.current = requestAnimationFrame(step);
    };

    frameRef.current = requestAnimationFrame(step);
  }, [paint, stopSpring]);

  useEffect(() => stopSpring, [stopSpring]);

  const handlePointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    stopSpring();

    draggingRef.current = true;
    movedRef.current = 0;
    originRef.current = { x: event.clientX, y: event.clientY };
    velocityRef.current = { x: 0, y: 0 };

    event.currentTarget.setPointerCapture(event.pointerId);
    event.currentTarget.classList.add("mac-compatibility-circle--dragging");
  };

  const handlePointerMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (!draggingRef.current) return;

    const deltaX = event.clientX - originRef.current.x;
    const deltaY = event.clientY - originRef.current.y;

    movedRef.current = Math.max(movedRef.current, Math.hypot(deltaX, deltaY));

    const next = { x: rubberBand(deltaX), y: rubberBand(deltaY) };

    velocityRef.current = {
      x: next.x - positionRef.current.x,
      y: next.y - positionRef.current.y,
    };

    positionRef.current = next;
    paint();
  };

  const handlePointerUp = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (!draggingRef.current) return;

    draggingRef.current = false;

    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }

    event.currentTarget.classList.remove("mac-compatibility-circle--dragging");
    startSpring();

    if (movedRef.current < CLICK_SLOP) onActivate?.();
  };

  const handleKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    if (event.key !== "Enter" && event.key !== " ") return;

    event.preventDefault();
    onActivate?.();
  };

  return (
    <div
      className={cn(
        "mac-compatibility-circle",
        `mac-compatibility-circle--${status}`,
        { "mac-compatibility-circle--busy": busy },
        className
      )}
      style={{ "--circle-size": `${size}px` } as CSSProperties}
    >
      <div
        ref={elementRef}
        className="mac-compatibility-circle__disc"
        role="button"
        tabIndex={0}
        aria-label={`Mac compatibility: ${meta.label}`}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerCancel={handlePointerUp}
        onKeyDown={handleKeyDown}
      >
        <span className="mac-compatibility-circle__glow" aria-hidden />

        <svg
          className="mac-compatibility-circle__ring"
          viewBox="0 0 100 100"
          aria-hidden
        >
          <circle
            className="mac-compatibility-circle__ring-track"
            cx="50"
            cy="50"
            r="46"
          />
          {ringProgress > 0 && (
            <circle
              className="mac-compatibility-circle__ring-value"
              cx="50"
              cy="50"
              r="46"
              pathLength={1}
              strokeDasharray={`${ringProgress} 1`}
            />
          )}
        </svg>

        <img
          className="mac-compatibility-circle__logo"
          src={HydraIcon}
          alt=""
          draggable={false}
        />
      </div>

      <div className="mac-compatibility-circle__caption">
        <span className="mac-compatibility-circle__status">{meta.label}</span>
        <span className="mac-compatibility-circle__description">
          {meta.description}
        </span>
      </div>
    </div>
  );
}
