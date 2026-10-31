import { NativeAddon } from "./native-addon";
import {
  getClientAreaCrop,
  getWindowHandleFromSourceId,
  type ImageCropRect,
} from "./windows-client-area-crop";

export interface SourceClientAreaCrop extends ImageCropRect {
  sourceWidth: number;
  sourceHeight: number;
}

export const getSourceClientAreaCrop = (
  sourceId: string
): SourceClientAreaCrop | null => {
  if (process.platform !== "win32") return null;

  const windowHandle = getWindowHandleFromSourceId(sourceId);
  if (!windowHandle) return null;

  const bounds = NativeAddon.getWindowsWindowBounds(windowHandle);
  if (!bounds) return null;

  const sourceWidth = bounds.frame.right - bounds.frame.left;
  const sourceHeight = bounds.frame.bottom - bounds.frame.top;
  const crop = getClientAreaCrop(bounds.frame, bounds.client, {
    width: sourceWidth,
    height: sourceHeight,
  });

  return crop ? { ...crop, sourceWidth, sourceHeight } : null;
};

export const cropToWindowClientArea = (
  image: Electron.NativeImage,
  sourceId: string
) => {
  const crop = getSourceClientAreaCrop(sourceId);
  if (!crop) return image;

  const size = image.getSize();
  const scaleX = size.width / crop.sourceWidth;
  const scaleY = size.height / crop.sourceHeight;
  const x = Math.round(crop.x * scaleX);
  const y = Math.round(crop.y * scaleY);

  return image.crop({
    x,
    y,
    width: Math.min(size.width - x, Math.round(crop.width * scaleX)),
    height: Math.min(size.height - y, Math.round(crop.height * scaleY)),
  });
};
