import {
  type PointerEvent as ReactPointerEvent,
  type RefObject,
  type WheelEvent as ReactWheelEvent,
  useCallback,
  useEffect,
  useRef,
} from "react";
import "./library-scrollbar.scss";

const MIN_THUMB_HEIGHT = 24;
const PAGE_SCROLL_RATIO = 0.875;

interface LibraryScrollbarProps {
  scrollElementRef: RefObject<HTMLElement>;
  onDraggingChange: (isDragging: boolean) => void;
}

interface DragState {
  pointerId: number;
  startY: number;
  startThumbTop: number;
}

export function LibraryScrollbar({
  scrollElementRef,
  onDraggingChange,
}: Readonly<LibraryScrollbarProps>) {
  const trackRef = useRef<HTMLDivElement>(null);
  const thumbRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<DragState | null>(null);
  const metricsRef = useRef({ trackHeight: 0, thumbHeight: 0, overflow: 0 });

  const placeThumb = useCallback((thumbTop: number) => {
    const thumb = thumbRef.current;
    if (thumb) thumb.style.transform = `translateY(${thumbTop}px)`;
  }, []);

  const layout = useCallback(() => {
    const element = scrollElementRef.current;
    const track = trackRef.current;
    const thumb = thumbRef.current;
    const parent = track?.parentElement;
    if (!element || !track || !thumb || !(parent instanceof HTMLElement)) {
      return;
    }

    const scrollbarWidth = element.offsetWidth - element.clientWidth;
    const overflow = element.scrollHeight - element.clientHeight;

    if (overflow <= 1 || scrollbarWidth <= 0) {
      track.style.display = "none";
      return;
    }

    const rect = element.getBoundingClientRect();
    const parentRect = parent.getBoundingClientRect();
    const trackHeight = rect.height;
    const thumbHeight = Math.max(
      MIN_THUMB_HEIGHT,
      (trackHeight * element.clientHeight) / element.scrollHeight
    );

    metricsRef.current = { trackHeight, thumbHeight, overflow };
    track.style.display = "block";
    track.style.top = `${rect.top - parentRect.top + parent.scrollTop}px`;
    track.style.left = `${parent.clientWidth - scrollbarWidth}px`;
    track.style.width = `${scrollbarWidth}px`;
    track.style.height = `${trackHeight}px`;
    thumb.style.height = `${thumbHeight}px`;

    if (!dragRef.current) {
      placeThumb((element.scrollTop / overflow) * (trackHeight - thumbHeight));
    }
  }, [placeThumb, scrollElementRef]);

  useEffect(() => {
    const element = scrollElementRef.current;
    if (!element) return;

    let animationFrameId = 0;
    const scheduleLayout = () => {
      if (animationFrameId) return;
      animationFrameId = requestAnimationFrame(() => {
        animationFrameId = 0;
        layout();
      });
    };

    layout();
    element.addEventListener("scroll", scheduleLayout, { passive: true });
    window.addEventListener("resize", scheduleLayout);

    const resizeObserver = new ResizeObserver(scheduleLayout);
    const observeChildren = () => {
      resizeObserver.disconnect();
      resizeObserver.observe(element);
      for (const child of element.children) resizeObserver.observe(child);
    };
    observeChildren();
    const mutationObserver = new MutationObserver(() => {
      observeChildren();
      scheduleLayout();
    });
    mutationObserver.observe(element, { childList: true });

    return () => {
      cancelAnimationFrame(animationFrameId);
      element.removeEventListener("scroll", scheduleLayout);
      window.removeEventListener("resize", scheduleLayout);
      resizeObserver.disconnect();
      mutationObserver.disconnect();
    };
  }, [layout, scrollElementRef]);

  const handleThumbPointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    const element = scrollElementRef.current;
    if (event.button !== 0 || !element) return;

    event.preventDefault();
    event.stopPropagation();
    event.currentTarget.setPointerCapture(event.pointerId);
    event.currentTarget.classList.add("library-scrollbar__thumb--dragging");
    onDraggingChange(true);

    const { trackHeight, thumbHeight, overflow } = metricsRef.current;
    dragRef.current = {
      pointerId: event.pointerId,
      startY: event.clientY,
      startThumbTop:
        overflow > 0
          ? (element.scrollTop / overflow) * (trackHeight - thumbHeight)
          : 0,
    };
  };

  const handleThumbPointerMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current;
    const element = scrollElementRef.current;
    if (!drag || drag.pointerId !== event.pointerId || !element) return;

    const { trackHeight, thumbHeight, overflow } = metricsRef.current;
    const travel = trackHeight - thumbHeight;
    if (travel <= 0) return;

    const thumbTop = Math.min(
      travel,
      Math.max(0, drag.startThumbTop + event.clientY - drag.startY)
    );

    placeThumb(thumbTop);
    element.scrollTop = (thumbTop / travel) * overflow;
  };

  const handleThumbPointerEnd = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (dragRef.current?.pointerId !== event.pointerId) return;

    dragRef.current = null;
    event.currentTarget.classList.remove("library-scrollbar__thumb--dragging");
    onDraggingChange(false);
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
    layout();
  };

  const handleTrackPointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    const element = scrollElementRef.current;
    const thumb = thumbRef.current;
    if (event.button !== 0 || !element || !thumb) return;

    event.preventDefault();
    const direction =
      event.clientY < thumb.getBoundingClientRect().top ? -1 : 1;
    element.scrollBy({
      top: direction * element.clientHeight * PAGE_SCROLL_RATIO,
    });
  };

  const handleWheel = (event: ReactWheelEvent<HTMLDivElement>) => {
    scrollElementRef.current?.scrollBy({ top: event.deltaY });
  };

  return (
    <div
      ref={trackRef}
      className="library-scrollbar"
      aria-hidden="true"
      onPointerDown={handleTrackPointerDown}
      onWheel={handleWheel}
    >
      <div
        ref={thumbRef}
        className="library-scrollbar__thumb"
        onPointerDown={handleThumbPointerDown}
        onPointerMove={handleThumbPointerMove}
        onPointerUp={handleThumbPointerEnd}
        onPointerCancel={handleThumbPointerEnd}
      />
    </div>
  );
}
