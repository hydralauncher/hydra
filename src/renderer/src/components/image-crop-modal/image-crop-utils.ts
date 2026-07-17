export interface ImageDimensions {
  width: number;
  height: number;
}

export const fitImageWithinBounds = (
  source: ImageDimensions,
  bounds: ImageDimensions
): ImageDimensions => {
  if (
    source.width <= 0 ||
    source.height <= 0 ||
    bounds.width <= 0 ||
    bounds.height <= 0
  ) {
    return bounds;
  }

  const sourceAspectRatio = source.width / source.height;
  const boundsAspectRatio = bounds.width / bounds.height;

  if (sourceAspectRatio >= boundsAspectRatio) {
    return {
      width: bounds.width,
      height: Math.max(1, Math.round(bounds.width / sourceAspectRatio)),
    };
  }

  return {
    width: Math.max(1, Math.round(bounds.height * sourceAspectRatio)),
    height: bounds.height,
  };
};
