import { useCallback, useEffect, useRef, useState } from "react";
import type { FocusEvent, PointerEvent } from "react";
import { BAYER_4X4, prefersReducedMotion } from "./gamification-colors";

const CELL_SIZE = 4;
const EASING = 0.14;
const MIN_RADIUS = 120;

/**
 * Dotted halo that follows the pointer, as in the designer's prototype.
 * `intensity` (0..1) eases in and out so children can react too (bar trail).
 */
export function useHoverHalo<T extends HTMLElement>(alpha: number) {
  const hostRef = useRef<T>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const halo = useRef({ amount: 0, target: 0, x: 0, y: 0, frame: 0 });
  const [intensity, setIntensity] = useState(0);

  const paint = useCallback(() => {
    const host = hostRef.current;
    const canvas = canvasRef.current;
    if (!host || !canvas) return;

    const width = host.clientWidth;
    const height = host.clientHeight;
    const pixelRatio = window.devicePixelRatio || 1;
    canvas.width = Math.round(width * pixelRatio);
    canvas.height = Math.round(height * pixelRatio);

    const context = canvas.getContext("2d");
    if (!context) return;
    context.setTransform(pixelRatio, 0, 0, pixelRatio, 0, 0);
    context.clearRect(0, 0, width, height);

    const { amount, x: pointerX, y: pointerY } = halo.current;
    if (amount <= 0) return;

    const radius = Math.max(MIN_RADIUS, Math.min(width, height) * 0.9);
    context.fillStyle = `rgba(240, 241, 247, ${alpha})`;
    for (let y = 0; y < height; y += CELL_SIZE) {
      for (let x = 0; x < width; x += CELL_SIZE) {
        const distance = Math.hypot(
          x + CELL_SIZE / 2 - pointerX,
          y + CELL_SIZE / 2 - pointerY
        );
        const strength = Math.max(0, 1 - distance / radius) * amount;
        const threshold = BAYER_4X4[(y / CELL_SIZE) % 4][(x / CELL_SIZE) % 4];
        if (strength > 0 && threshold < strength * 16 * 0.85) {
          context.fillRect(x, y, CELL_SIZE - 1, CELL_SIZE - 1);
        }
      }
    }
  }, [alpha]);

  const loop = useCallback(() => {
    const state = halo.current;
    state.amount +=
      (state.target - state.amount) * (prefersReducedMotion() ? 1 : EASING);
    if (Math.abs(state.target - state.amount) < 0.01) {
      state.amount = state.target;
    }
    paint();
    setIntensity(state.amount);
    state.frame =
      state.amount === state.target ? 0 : requestAnimationFrame(loop);
  }, [paint]);

  const kick = useCallback(() => {
    if (!halo.current.frame) {
      halo.current.frame = requestAnimationFrame(loop);
    }
  }, [loop]);

  const trackPointer = useCallback((event: PointerEvent<T>) => {
    const rect = event.currentTarget.getBoundingClientRect();
    halo.current.x = event.clientX - rect.left;
    halo.current.y = event.clientY - rect.top;
  }, []);

  useEffect(() => () => cancelAnimationFrame(halo.current.frame), []);

  const handlers = {
    onPointerEnter: (event: PointerEvent<T>) => {
      halo.current.target = 1;
      trackPointer(event);
      kick();
    },
    onPointerMove: (event: PointerEvent<T>) => {
      trackPointer(event);
      kick();
    },
    onPointerLeave: () => {
      halo.current.target = 0;
      kick();
    },
    onFocus: (event: FocusEvent<T>) => {
      const rect = event.currentTarget.getBoundingClientRect();
      halo.current.x = rect.width / 2;
      halo.current.y = rect.height / 2;
      halo.current.target = 1;
      kick();
    },
    onBlur: () => {
      halo.current.target = 0;
      kick();
    },
  };

  return { hostRef, canvasRef, intensity, handlers };
}
