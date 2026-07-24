type WindowBounds = {
  x: number;
  y: number;
  width: number;
  height: number;
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
