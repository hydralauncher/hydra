import { useEffect, useRef, useState } from "react";
import { prefersReducedMotion } from "./gamification-colors";

const COUNT_DURATION_MS = 700;

/** Counts to `value` with a cubic ease-out whenever it changes (the prototype's balance count-up). */
export function useAnimatedNumber(value: number) {
  const [shown, setShown] = useState(value);
  const shownRef = useRef(value);

  useEffect(() => {
    const from = shownRef.current;
    if (from === value || prefersReducedMotion()) {
      shownRef.current = value;
      setShown(value);
      return;
    }

    const start = performance.now();
    let frame = 0;
    const step = (now: number) => {
      const progress = Math.min(1, (now - start) / COUNT_DURATION_MS);
      const eased = 1 - (1 - progress) ** 3;
      const next = Math.round(from + (value - from) * eased);
      shownRef.current = next;
      setShown(next);
      if (progress < 1) frame = requestAnimationFrame(step);
    };
    frame = requestAnimationFrame(step);

    return () => cancelAnimationFrame(frame);
  }, [value]);

  return shown;
}
