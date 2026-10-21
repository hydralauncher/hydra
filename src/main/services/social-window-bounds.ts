export interface WindowRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

const MIN_VISIBLE_WIDTH = 120;
const MIN_VISIBLE_HEIGHT = 40;

const getVisibleArea = (rect: WindowRect, area: WindowRect) => ({
  width:
    Math.min(rect.x + rect.width, area.x + area.width) -
    Math.max(rect.x, area.x),
  height:
    Math.min(rect.y + rect.height, area.y + area.height) -
    Math.max(rect.y, area.y),
});

const isFiniteRect = (rect: WindowRect) =>
  [rect.x, rect.y, rect.width, rect.height].every(Number.isFinite);

export const resolveSocialWindowBounds = (
  saved: WindowRect | null | undefined,
  workAreas: WindowRect[],
  minimumSize: { width: number; height: number }
): Partial<WindowRect> | null => {
  if (!saved || !isFiniteRect(saved)) return null;

  const width = Math.max(Math.round(saved.width), minimumSize.width);
  const height = Math.max(Math.round(saved.height), minimumSize.height);
  const rect = {
    x: Math.round(saved.x),
    y: Math.round(saved.y),
    width,
    height,
  };

  const isOnScreen = workAreas.some((area) => {
    const visible = getVisibleArea(rect, area);
    return (
      visible.width >= MIN_VISIBLE_WIDTH && visible.height >= MIN_VISIBLE_HEIGHT
    );
  });

  return isOnScreen ? rect : { width, height };
};
