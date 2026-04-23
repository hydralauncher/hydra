const SAFE_SCROLL_MARGIN = 96;
const SCROLL_ANIMATION_DURATION = 120;

const scrollAnimationFrames = new WeakMap<Element, number>();

function easeOutCubic(progress: number): number {
  return 1 - Math.pow(1 - progress, 3);
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

function isScrollableElement(element: HTMLElement): boolean {
  const style = globalThis.getComputedStyle(element);
  const overflow = `${style.overflow} ${style.overflowX} ${style.overflowY}`;
  const canScroll = /(auto|scroll|overlay)/.test(overflow);

  return (
    canScroll &&
    (element.scrollHeight > element.clientHeight ||
      element.scrollWidth > element.clientWidth)
  );
}

function getScrollContainer(element: HTMLElement): HTMLElement {
  let current = element.parentElement;

  while (current && current !== document.body) {
    if (isScrollableElement(current)) {
      return current;
    }

    current = current.parentElement;
  }

  return (document.scrollingElement ?? document.documentElement) as HTMLElement;
}

function getContainerRect(container: HTMLElement): DOMRect {
  if (container === document.scrollingElement) {
    return new DOMRect(0, 0, globalThis.innerWidth, globalThis.innerHeight);
  }

  return container.getBoundingClientRect();
}

function getSafeMargin(containerRect: DOMRect): { x: number; y: number } {
  return {
    x: Math.min(SAFE_SCROLL_MARGIN, Math.max(0, containerRect.width / 2 - 1)),
    y: Math.min(SAFE_SCROLL_MARGIN, Math.max(0, containerRect.height / 2 - 1)),
  };
}

function getScrollTarget(element: HTMLElement, container: HTMLElement) {
  const elementRect = element.getBoundingClientRect();
  const containerRect = getContainerRect(container);
  const safeMargin = getSafeMargin(containerRect);

  const safeTop = containerRect.top + safeMargin.y;
  const safeBottom = containerRect.bottom - safeMargin.y;
  const safeLeft = containerRect.left + safeMargin.x;
  const safeRight = containerRect.right - safeMargin.x;

  let deltaY = 0;
  let deltaX = 0;

  if (elementRect.top < safeTop) {
    deltaY = elementRect.top - safeTop;
  } else if (elementRect.bottom > safeBottom) {
    deltaY = elementRect.bottom - safeBottom;
  }

  if (elementRect.left < safeLeft) {
    deltaX = elementRect.left - safeLeft;
  } else if (elementRect.right > safeRight) {
    deltaX = elementRect.right - safeRight;
  }

  const maxTop = Math.max(0, container.scrollHeight - container.clientHeight);
  const maxLeft = Math.max(0, container.scrollWidth - container.clientWidth);

  return {
    left: clamp(container.scrollLeft + deltaX, 0, maxLeft),
    top: clamp(container.scrollTop + deltaY, 0, maxTop),
  };
}

function cancelScrollAnimation(container: HTMLElement): void {
  const animationFrame = scrollAnimationFrames.get(container);

  if (animationFrame === undefined) return;

  globalThis.cancelAnimationFrame(animationFrame);
  scrollAnimationFrames.delete(container);
}

function animateScroll(
  container: HTMLElement,
  target: { left: number; top: number }
): void {
  cancelScrollAnimation(container);

  const startLeft = container.scrollLeft;
  const startTop = container.scrollTop;
  const distanceLeft = target.left - startLeft;
  const distanceTop = target.top - startTop;

  if (distanceLeft === 0 && distanceTop === 0) return;

  const startTime = performance.now();

  const step = (now: number) => {
    const elapsed = now - startTime;
    const progress = clamp(elapsed / SCROLL_ANIMATION_DURATION, 0, 1);
    const easedProgress = easeOutCubic(progress);

    container.scrollLeft = startLeft + distanceLeft * easedProgress;
    container.scrollTop = startTop + distanceTop * easedProgress;

    if (progress < 1) {
      scrollAnimationFrames.set(
        container,
        globalThis.requestAnimationFrame(step)
      );
      return;
    }

    container.scrollLeft = target.left;
    container.scrollTop = target.top;
    scrollAnimationFrames.delete(container);
  };

  scrollAnimationFrames.set(container, globalThis.requestAnimationFrame(step));
}

export function scrollFocusedElementIntoView(element: HTMLElement): void {
  const container = getScrollContainer(element);
  const target = getScrollTarget(element, container);

  animateScroll(container, target);
}
