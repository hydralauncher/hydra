const MIN_DURATION_MS = 320;
const MAX_DURATION_MS = 600;
const DURATION_PER_PIXEL_MS = 0.12;

const easeInOutCubic = (progress: number) =>
  progress < 0.5 ? 4 * progress ** 3 : 1 - (-2 * progress + 2) ** 3 / 2;

const activeAnimations = new WeakMap<HTMLElement, () => void>();

export function scrollToTop(element: HTMLElement) {
  activeAnimations.get(element)?.();

  const startTop = element.scrollTop;
  if (startTop <= 0) return;

  if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
    element.scrollTop = 0;
    return;
  }

  let frameId = 0;
  const startedAt = performance.now();
  const duration = Math.min(
    MAX_DURATION_MS,
    Math.max(MIN_DURATION_MS, 250 + startTop * DURATION_PER_PIXEL_MS)
  );

  const stop = () => {
    cancelAnimationFrame(frameId);
    element.removeEventListener("wheel", stop);
    element.removeEventListener("touchstart", stop);
    if (activeAnimations.get(element) === stop) {
      activeAnimations.delete(element);
    }
  };

  const step = (now: number) => {
    const progress = Math.min(1, (now - startedAt) / duration);
    element.scrollTop = startTop * (1 - easeInOutCubic(progress));
    if (progress < 1) frameId = requestAnimationFrame(step);
    else stop();
  };

  activeAnimations.set(element, stop);
  element.addEventListener("wheel", stop, { passive: true });
  element.addEventListener("touchstart", stop, { passive: true });
  frameId = requestAnimationFrame(step);
}
