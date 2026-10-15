import { useEffect, useRef, useState } from "react";

const DRAG_THRESHOLD_PX = 5;
const MOMENTUM_DECAY = 0.92;
const MOMENTUM_RELEASE_WINDOW_MS = 80;
const MOMENTUM_MIN_VELOCITY = 0.5;

export function useDragScroll() {
  const dragRef = useRef({
    pointerId: -1,
    startX: 0,
    startScroll: 0,
    lastX: 0,
    lastTime: 0,
    velocity: 0,
    moved: false,
  });
  const momentumFrameRef = useRef(0);
  const [dragging, setDragging] = useState(false);

  useEffect(() => {
    return () => cancelAnimationFrame(momentumFrameRef.current);
  }, []);

  const onPointerDown = (event: React.PointerEvent<HTMLElement>) => {
    if (event.button !== 0) return;
    cancelAnimationFrame(momentumFrameRef.current);
    dragRef.current = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startScroll: event.currentTarget.scrollLeft,
      lastX: event.clientX,
      lastTime: performance.now(),
      velocity: 0,
      moved: false,
    };
  };

  const onPointerMove = (event: React.PointerEvent<HTMLElement>) => {
    const drag = dragRef.current;
    if (drag.pointerId !== event.pointerId) return;

    const deltaX = event.clientX - drag.startX;
    if (!drag.moved) {
      if (Math.abs(deltaX) < DRAG_THRESHOLD_PX) return;
      drag.moved = true;
      setDragging(true);
      event.currentTarget.setPointerCapture(event.pointerId);
    }

    const now = performance.now();
    const elapsed = Math.max(now - drag.lastTime, 1);
    drag.velocity = (event.clientX - drag.lastX) / elapsed;
    drag.lastX = event.clientX;
    drag.lastTime = now;
    event.currentTarget.scrollLeft = drag.startScroll - deltaX;
  };

  const onPointerUp = (event: React.PointerEvent<HTMLElement>) => {
    const drag = dragRef.current;
    if (drag.pointerId !== event.pointerId) return;
    drag.pointerId = -1;

    if (!drag.moved) return;

    const track = event.currentTarget;
    if (track.hasPointerCapture(event.pointerId)) {
      track.releasePointerCapture(event.pointerId);
    }
    setDragging(false);

    let velocity =
      performance.now() - drag.lastTime > MOMENTUM_RELEASE_WINDOW_MS
        ? 0
        : drag.velocity * 16;

    const step = () => {
      if (Math.abs(velocity) < MOMENTUM_MIN_VELOCITY) return;
      track.scrollLeft -= velocity;
      velocity *= MOMENTUM_DECAY;
      momentumFrameRef.current = requestAnimationFrame(step);
    };

    momentumFrameRef.current = requestAnimationFrame(step);
  };

  const onClickCapture = (event: React.MouseEvent) => {
    if (!dragRef.current.moved) return;
    dragRef.current.moved = false;
    event.preventDefault();
    event.stopPropagation();
  };

  return {
    dragging,
    handlers: {
      onPointerDown,
      onPointerMove,
      onPointerUp,
      onPointerCancel: onPointerUp,
      onClickCapture,
    },
  };
}
