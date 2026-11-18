import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import sharp from "sharp";

import { registerEvent } from "../register-event";
import { ASSETS_PATH } from "@main/constants";
import { logger } from "@main/services";
import { downloadGameArtworkFile } from "../library/download-game-artwork";

const THUMBNAIL_DIR = path.join(ASSETS_PATH, "banner-thumbnails");
const THUMBNAIL_VERSION = "v1";
// The edit profile tiles are ~230px wide; this covers 2x displays.
const THUMBNAIL_WIDTH = 480;

const inflightThumbnails = new Map<string, Promise<string | null>>();

const hashUrl = (url: string) =>
  crypto.createHash("sha256").update(url).digest("hex").slice(0, 32);

const buildBannerThumbnail = async (url: string) => {
  const thumbnailPath = path.join(
    THUMBNAIL_DIR,
    `${hashUrl(url)}-${THUMBNAIL_VERSION}.webp`
  );

  if (fs.existsSync(thumbnailPath)) return `local:${thumbnailPath}`;

  const sourcePath = await downloadGameArtworkFile(url);
  if (!sourcePath) return null;

  try {
    // Animated heroes can go past sharp's default pixel limit, counting
    // every frame; the downloaded file is already capped at 20 MB.
    const thumbnail = await sharp(sourcePath, {
      animated: true,
      limitInputPixels: false,
    })
      .resize({ width: THUMBNAIL_WIDTH, withoutEnlargement: true })
      .webp({ quality: 75, effort: 2 })
      .toBuffer();

    await fs.promises.mkdir(THUMBNAIL_DIR, { recursive: true });
    await fs.promises.writeFile(thumbnailPath, thumbnail);

    return `local:${thumbnailPath}`;
  } finally {
    await fs.promises.unlink(sourcePath).catch(() => {});
  }
};

/**
 * A small copy of a SteamGridDB hero, animation kept. Chromium decodes every
 * frame of an animated WebP at full size, so the originals stall the page.
 */
const getBannerThumbnail = async (
  _event: Electron.IpcMainInvokeEvent,
  url: string
): Promise<string | null> => {
  const existing = inflightThumbnails.get(url);
  if (existing !== undefined) return existing;

  const request = buildBannerThumbnail(url)
    .catch((error) => {
      logger.warn("Failed to build banner thumbnail", error);
      return null;
    })
    .finally(() => inflightThumbnails.delete(url));

  inflightThumbnails.set(url, request);
  return request;
};

registerEvent("getBannerThumbnail", getBannerThumbnail);
