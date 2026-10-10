import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type RefObject,
} from "react";
import cn from "classnames";

import {
  getScrollbarThumb,
  getScrollDeltaForThumb,
  type ScrollbarThumb,
  type ScrollMetrics,
} from "./chat-scrollbar-math";

/** The track stops this far from the viewport's top and bottom edges. */
const TRACK_INSET_PX = 4;
/** How long the thumb stays visible after scrolling stops. */
const VISIBLE_AFTER_SCROLL_MS = 1000;

// The list is column-reverse, so scrollTop is 0 at the bottom and negative
// going up.
const readMetrics = (element: HTMLElement): ScrollMetrics => ({
  scrollHeight: element.scrollHeight,
  clientHeight: element.clientHeight,
  scrollFromTop:
    element.scrollHeight - element.clientHeight + element.scrollTop,
});

const getTrackHeight = (element: HTMLElement) =>
  element.clientHeight - TRACK_INSET_PX * 2;

export interface ChatScrollbarProps {
  scrollRef: RefObject<HTMLElement>;
}

/**
 * Thin overlay scrollbar for the message list, which hides its native one. It
 * only draws the position and handles dragging: wheel, keyboard and touch
 * scrolling stay native.
 */
export function ChatScrollbar({ scrollRef }: Readonly<ChatScrollbarProps>) {
  const [thumb, setThumb] = useState<ScrollbarThumb | null>(null);
  const [isScrolling, setIsScrolling] = useState(false);
  const [isDragging, setIsDragging] = useState(false);
  const dragRef = useRef<{ pointerY: number; scrollTop: number } | null>(null);

  const update = useCallback(() => {
    const element = scrollRef.current;
    if (!element) return;
    setThumb(getScrollbarThumb(readMetrics(element), getTrackHeight(element)));
  }, [scrollRef]);

  useEffect(() => {
    const element = scrollRef.current;
    if (!element) return;

    let hideTimer: ReturnType<typeof setTimeout> | undefined;
    const handleScroll = () => {
      update();
      setIsScrolling(true);
      clearTimeout(hideTimer);
      hideTimer = setTimeout(
        () => setIsScrolling(false),
        VISIBLE_AFTER_SCROLL_MS
      );
    };

    // The content grows as messages arrive and older history loads.
    const observer = new ResizeObserver(update);
    observer.observe(element);
    if (element.firstElementChild) observer.observe(element.firstElementChild);

    update();
    element.addEventListener("scroll", handleScroll, { passive: true });

    return () => {
      clearTimeout(hideTimer);
      observer.disconnect();
      element.removeEventListener("scroll", handleScroll);
    };
  }, [scrollRef, update]);

  const handlePointerDown = (event: React.PointerEvent<HTMLDivElement>) => {
    const element = scrollRef.current;
    if (!element || event.button !== 0) return;

    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    dragRef.current = { pointerY: event.clientY, scrollTop: element.scrollTop };
    setIsDragging(true);
  };

  const handlePointerMove = (event: React.PointerEvent<HTMLDivElement>) => {
    const element = scrollRef.current;
    const drag = dragRef.current;
    if (!element || !drag) return;

    element.scrollTop =
      drag.scrollTop +
      getScrollDeltaForThumb(
        event.clientY - drag.pointerY,
        readMetrics(element),
        getTrackHeight(element)
      );
  };

  const endDrag = () => {
    dragRef.current = null;
    setIsDragging(false);
  };

  if (!thumb) return null;

  return (
    <div
      className={cn("chat-window__scrollbar", {
        "chat-window__scrollbar--visible": isScrolling || isDragging,
      })}
      aria-hidden="true"
    >
      <div
        className={cn("chat-window__scrollbar-thumb", {
          "chat-window__scrollbar-thumb--dragging": isDragging,
        })}
        style={{
          height: thumb.height,
          transform: `translateY(${thumb.top}px)`,
        }}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={endDrag}
        onPointerCancel={endDrag}
      />
    </div>
  );
}
