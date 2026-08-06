type WindowBounds = {
  x: number;
  y: number;
  width: number;
  height: number;
};

type DisplayBounds = {
  id: number;
  bounds: WindowBounds;
  scaleFactor: number;
};

const intersectionArea = (first: WindowBounds, second: WindowBounds) => {
  const width = Math.max(
    0,
    Math.min(first.x + first.width, second.x + second.width) -
      Math.max(first.x, second.x)
  );
  const height = Math.max(
    0,
    Math.min(first.y + first.height, second.y + second.height) -
      Math.max(first.y, second.y)
  );
  return width * height;
};

export const findDisplayForNativeBounds = <T extends DisplayBounds>(
  windowBounds: WindowBounds,
  displays: T[]
) => {
  const scoreDisplay = (display: T) =>
    Math.max(
      intersectionArea(windowBounds, display.bounds),
      intersectionArea(windowBounds, {
        x: display.bounds.x * display.scaleFactor,
        y: display.bounds.y * display.scaleFactor,
        width: display.bounds.width * display.scaleFactor,
        height: display.bounds.height * display.scaleFactor,
      })
    );

  const best = displays.reduce<T | null>((current, display) => {
    if (!current) return display;
    return scoreDisplay(display) > scoreDisplay(current) ? display : current;
  }, null);
  return best && scoreDisplay(best) > 0 ? best : null;
};

export const fitAuxiliaryWindow = (
  target: WindowBounds,
  preferredWidth: number,
  preferredHeight: number,
  preferredMargin: number,
  horizontal: "left" | "right"
): WindowBounds => {
  const margin = Math.min(
    preferredMargin,
    Math.max(0, Math.floor(Math.min(target.width, target.height) / 8))
  );
  const width = Math.max(
    1,
    Math.min(preferredWidth, target.width - margin * 2)
  );
  const height = Math.max(
    1,
    Math.min(preferredHeight, target.height - margin * 2)
  );

  return {
    x:
      horizontal === "right"
        ? target.x + target.width - width - margin
        : target.x + margin,
    y: target.y + margin,
    width,
    height,
  };
};

export const boundsFillDisplay = (
  windowBounds: WindowBounds,
  displayBounds: WindowBounds,
  tolerance = 2
) =>
  Math.abs(windowBounds.x - displayBounds.x) <= tolerance &&
  Math.abs(windowBounds.y - displayBounds.y) <= tolerance &&
  Math.abs(windowBounds.width - displayBounds.width) <= tolerance &&
  Math.abs(windowBounds.height - displayBounds.height) <= tolerance;
