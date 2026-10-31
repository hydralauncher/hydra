/** Shortest thumb, so a long history still leaves something to grab. */
export const MIN_THUMB_HEIGHT = 24;

export interface ScrollMetrics {
  scrollHeight: number;
  clientHeight: number;
  /** Distance scrolled from the top of the content. */
  scrollFromTop: number;
}

export interface ScrollbarThumb {
  top: number;
  height: number;
}

/** Thumb geometry on a track of `trackHeight`; null when nothing scrolls. */
export const getScrollbarThumb = (
  { scrollHeight, clientHeight, scrollFromTop }: ScrollMetrics,
  trackHeight: number
): ScrollbarThumb | null => {
  const scrollRange = scrollHeight - clientHeight;
  if (scrollRange < 1 || trackHeight <= 0) return null;

  const height = Math.min(
    trackHeight,
    Math.max(MIN_THUMB_HEIGHT, (clientHeight / scrollHeight) * trackHeight)
  );
  const progress = Math.min(Math.max(scrollFromTop / scrollRange, 0), 1);

  return { top: progress * (trackHeight - height), height };
};

/** Content pixels to scroll when the thumb is dragged by `thumbDelta`. */
export const getScrollDeltaForThumb = (
  thumbDelta: number,
  metrics: ScrollMetrics,
  trackHeight: number
) => {
  const thumb = getScrollbarThumb(metrics, trackHeight);
  if (!thumb || trackHeight <= thumb.height) return 0;

  const scrollRange = metrics.scrollHeight - metrics.clientHeight;
  return thumbDelta * (scrollRange / (trackHeight - thumb.height));
};
