import crypto from "node:crypto";
import path from "node:path";
import sharp from "sharp";

/**
 * Electron's `nativeImage` only decodes PNG and JPEG (plus `.ico` on Windows),
 * and `createFromPath` silently returns an empty image for anything else. Hydra
 * avatars are cropped to WebP (see `crop-profile-image.ts`), so every downloaded
 * icon has to be transcoded before it can be handed to a `Notification`.
 */
const NOTIFICATION_ICON_SIZE = 256;

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
    .slice(0, 10);
  const hash = crypto.createHash("sha1").update(url).digest("hex");

  return `hydra-notification-source-${hash}${extension}`;
};

/**
 * Transcodes an image to a PNG that `nativeImage` can decode. Animation is
 * dropped on purpose: neither Windows toasts nor `nativeImage` animate.
 */
export const transcodeNotificationIcon = async (
  imagePath: string,
  outputDirectory: string
) => {
  const hash = crypto.createHash("sha1").update(imagePath).digest("hex");
  const outputPath = path.join(
    outputDirectory,
    `hydra-notification-icon-${hash}.png`
  );

  await sharp(imagePath)
    .resize(NOTIFICATION_ICON_SIZE, NOTIFICATION_ICON_SIZE, { fit: "cover" })
    .png()
    .toFile(outputPath);

  return outputPath;
};
