const EDGE_ZONE = 96;
const MAX_STEP = 22;

const getStep = (distanceFromEdge: number) =>
  Math.ceil(MAX_STEP * (1 - Math.max(distanceFromEdge, 0) / EDGE_ZONE));

export const createLibraryDragAutoscroll = (
  getContainer: () => HTMLElement | null
) => {
  let pointerY: number | null = null;
  let frame = 0;

  const scroll = () => {
    frame = 0;
    const container = getContainer();
    if (!container || pointerY === null) return;

    const rect = container.getBoundingClientRect();
    const fromTop = pointerY - rect.top;
    const fromBottom = rect.bottom - pointerY;

    let delta = 0;
    if (fromTop < EDGE_ZONE) delta = -getStep(fromTop);
    else if (fromBottom < EDGE_ZONE) delta = getStep(fromBottom);
    if (delta === 0) return;

    container.scrollTop += delta;
    frame = requestAnimationFrame(scroll);
  };

  return {
    update: (clientY: number) => {
      pointerY = clientY;
      if (!frame) frame = requestAnimationFrame(scroll);
    },
    stop: () => {
      pointerY = null;
      cancelAnimationFrame(frame);
      frame = 0;
    },
  };
};
