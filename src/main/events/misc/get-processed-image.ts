import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { net } from "electron";
import { registerEvent } from "../register-event";
import { logger, NativeAddon } from "@main/services";
import { SystemPath } from "@main/services/system-path";

type ProcessedImageOptions = {
  width: number;
  height: number;
  preserveAnimation?: boolean;
};

const MAX_DIMENSION = 2048;
const CACHE_VERSION = 2;
const MAX_CACHE_BYTES = 256 * 1024 * 1024;
const PRUNE_INTERVAL_MS = 10 * 60 * 1000;
const inFlight = new Map<string, Promise<string>>();
// The renderer keeps served paths in memory for the whole session, so the
// prune never deletes them, even when it is used from the renderer cache.
const servedThisSession = new Set<string>();

const isHttpUrl = (url: string) =>
  url.startsWith("http://") || url.startsWith("https://");

const validateOptions = ({ width, height }: ProcessedImageOptions) => {
  return (
    Number.isInteger(width) &&
    Number.isInteger(height) &&
    width > 0 &&
    height > 0 &&
    width <= MAX_DIMENSION &&
    height <= MAX_DIMENSION
  );
};

const getCacheDir = () => {
  return path.join(SystemPath.getPath("userData"), "image-cache", "processed");
};

let hasRemovedLegacyCache = false;

const removeLegacyCacheDir = async () => {
  if (hasRemovedLegacyCache) return;
  hasRemovedLegacyCache = true;

  const legacyCacheDir = path.join(
    SystemPath.getPath("userData"),
    "image-cache",
    "friends"
  );

  try {
    await fs.promises.rm(legacyCacheDir, { recursive: true, force: true });
  } catch (error) {
    logger.error("Failed to remove legacy friend image cache", error);
  }
};

const getCacheKey = (
  imageUrl: string,
  options: Required<ProcessedImageOptions>
) => {
  return crypto
    .createHash("sha256")
    .update(
      JSON.stringify({
        imageUrl,
        version: CACHE_VERSION,
        width: options.width,
        height: options.height,
        preserveAnimation: options.preserveAnimation,
      })
    )
    .digest("hex");
};

const findCachedImage = async (outputBase: string) => {
  for (const extension of ["gif", "webp"]) {
    const imagePath = `${outputBase}.${extension}`;

    if (fs.existsSync(imagePath)) {
      // Keeps recently used images out of the next prune.
      const now = new Date();
      void fs.promises.utimes(imagePath, now, now).catch(() => {});
      servedThisSession.add(imagePath);
      return imagePath;
    }
  }

  return null;
};

let lastPruneAt = 0;

// Deletes the least recently used images once the cache passes the limit, so
// browsing many profiles and leaderboards does not grow it without bound.
const pruneCache = async (cacheDir: string) => {
  const now = Date.now();
  if (now - lastPruneAt < PRUNE_INTERVAL_MS) return;
  lastPruneAt = now;

  const names = await fs.promises.readdir(cacheDir);
  const files = (
    await Promise.all(
      names
        .filter(
          (name) =>
            !name.includes("-tmp") &&
            !servedThisSession.has(path.join(cacheDir, name))
        )
        .map(async (name) => {
          const filePath = path.join(cacheDir, name);
          const stats = await fs.promises.stat(filePath).catch(() => null);
          return stats?.isFile()
            ? { filePath, size: stats.size, usedAt: stats.mtimeMs }
            : null;
        })
    )
  ).filter((file) => file !== null);

  let total = files.reduce((sum, file) => sum + file.size, 0);
  if (total <= MAX_CACHE_BYTES) return;

  files.sort((a, b) => a.usedAt - b.usedAt);
  const evicted: string[] = [];
  for (const file of files) {
    if (total <= MAX_CACHE_BYTES) break;
    evicted.push(file.filePath);
    total -= file.size;
  }

  await Promise.allSettled(
    evicted.map((filePath) => fs.promises.unlink(filePath))
  );
};

const downloadImage = async (imageUrl: string, outputPath: string) => {
  const response = await net.fetch(imageUrl);

  if (!response.ok) {
    throw new Error(`Image download failed with status ${response.status}`);
  }

  const contentType = response.headers.get("content-type")?.split(";")[0];

  if (contentType && !contentType.startsWith("image/")) {
    throw new Error(`Unexpected image content type: ${contentType}`);
  }

  const buffer = Buffer.from(await response.arrayBuffer());
  await fs.promises.writeFile(outputPath, buffer);
};

const processAndCacheImage = async (
  imageUrl: string,
  options: Required<ProcessedImageOptions>
) => {
  const cacheDir = getCacheDir();
  await fs.promises.mkdir(cacheDir, { recursive: true });
  void removeLegacyCacheDir();

  const cacheKey = getCacheKey(imageUrl, options);
  const outputBase = path.join(cacheDir, cacheKey);
  const cachedImage = await findCachedImage(outputBase);

  if (cachedImage) return `local:${cachedImage}`;

  const tempBase = path.join(
    cacheDir,
    `${cacheKey}-${process.pid}-${Date.now()}-tmp`
  );
  const downloadPath = `${tempBase}.input`;

  try {
    await downloadImage(imageUrl, downloadPath);

    const processedImage = await NativeAddon.processImage(
      downloadPath,
      tempBase,
      options.width,
      options.height,
      options.preserveAnimation
    );

    const extension = path.extname(processedImage.imagePath);
    const finalPath = `${outputBase}${extension}`;

    await fs.promises.rename(processedImage.imagePath, finalPath);
    servedThisSession.add(finalPath);
    void pruneCache(cacheDir).catch((error) =>
      logger.error("Failed to prune processed image cache", error)
    );

    return `local:${finalPath}`;
  } finally {
    await Promise.allSettled([
      fs.promises.unlink(downloadPath),
      fs.promises.unlink(`${tempBase}.gif`),
      fs.promises.unlink(`${tempBase}.webp`),
    ]);
  }
};

const getProcessedImage = async (
  _event: Electron.IpcMainInvokeEvent,
  imageUrl: string | null,
  options: ProcessedImageOptions
): Promise<string | null> => {
  if (!imageUrl || !isHttpUrl(imageUrl)) return imageUrl;
  if (!validateOptions(options)) return imageUrl;

  const normalizedOptions = {
    width: options.width,
    height: options.height,
    preserveAnimation: options.preserveAnimation ?? true,
  };
  const sourceUrl = imageUrl;
  const inFlightKey = getCacheKey(sourceUrl, normalizedOptions);

  try {
    const existingRequest = inFlight.get(inFlightKey);

    if (existingRequest !== undefined) return await existingRequest;

    const request = processAndCacheImage(sourceUrl, normalizedOptions);
    inFlight.set(inFlightKey, request);

    return await request;
  } catch (error) {
    logger.error("Failed to process image", { imageUrl, error });
    return imageUrl;
  } finally {
    inFlight.delete(inFlightKey);
  }
};

registerEvent("getProcessedImage", getProcessedImage);
