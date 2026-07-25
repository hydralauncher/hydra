import crypto from "node:crypto";
import path from "node:path";
import sharp from "sharp";

/**
 * Longest bound for the icon handed to a `Notification`. Windows toasts and
 * libnotify both scale the image down anyway, so anything larger is wasted.
 */
export const NOTIFICATION_ICON_SIZE = 256;

/** Longest source extension kept when naming the temp download. */
const MAX_EXTENSION_LENGTH = 10;

/**
 * Builds a filesystem-safe name for the temp copy of a remote image. The remote
 * basename can carry a query string or characters that are illegal on Windows,
 * so the name is derived from a hash of the URL and only the extension is kept.
 */
export const buildDownloadFileName = (url: string) => {
  const pathname = (() => {
    try {
      return new URL(url).pathname;
    } catch {
      return url.split(/[?#]/)[0];
    }
  })();

  const baseName = pathname.split("/").pop() ?? "";
  const extension = path
    .extname(baseName)
    .replace(/[^\w.]/g, "")
    .slice(0, MAX_EXTENSION_LENGTH);
  const hash = crypto.createHash("sha256").update(url).digest("hex");

  return `source-${hash}${extension}`;
};

/**
 * Transcodes an image to a PNG that `nativeImage` can decode. Electron's
 * `nativeImage` only handles PNG and JPEG (plus `.ico` on Windows) and
 * `createFromPath` silently returns an empty image for anything else, so every
 * downloaded icon has to go through here before it reaches a `Notification`.
 *
 * `fit: "inside"` preserves the source aspect ratio: profile pictures are
 * already square (see `crop-profile-image.ts`), but game and achievement icons
 * are not, and cropping them to a square would cut off their sides. Upscaling
 * is skipped so a small source icon is not blown up into a blurry one.
 *
 * Animation is dropped on purpose: neither Windows toasts nor `nativeImage`
 * animate.
 */
export const transcodeNotificationIcon = async (
  imagePath: string,
  outputDirectory: string
) => {
  const hash = crypto.createHash("sha256").update(imagePath).digest("hex");
  const outputPath = path.join(outputDirectory, `icon-${hash}.png`);

  await sharp(imagePath)
    .resize(NOTIFICATION_ICON_SIZE, NOTIFICATION_ICON_SIZE, {
      fit: "inside",
      withoutEnlargement: true,
    })
    .png()
    .toFile(outputPath);

  return outputPath;
};
