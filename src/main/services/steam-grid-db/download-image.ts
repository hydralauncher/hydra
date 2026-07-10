import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { net } from "electron";
import { ASSETS_PATH } from "@main/constants";
import { logger } from "../logger";

const CACHE_DIR = path.join(ASSETS_PATH, "steamgriddb");
const inFlight = new Map<string, Promise<string | null>>();

export const getSgdbCacheDir = () => CACHE_DIR;

const download = async (url: string): Promise<string> => {
  await fs.promises.mkdir(CACHE_DIR, { recursive: true });

  let extension = ".png";
  try {
    const parsedExtension = path.extname(new URL(url).pathname);
    if (parsedExtension) extension = parsedExtension;
  } catch {
    // keep default extension
  }

  const hash = crypto.createHash("sha256").update(url).digest("hex");
  const finalPath = path.join(CACHE_DIR, `${hash}${extension}`);

  if (fs.existsSync(finalPath)) return `local:${finalPath}`;

  const response = await net.fetch(url);
  if (!response.ok) {
    throw new Error(`Image download failed with status ${response.status}`);
  }

  const contentType = response.headers.get("content-type")?.split(";")[0];
  if (contentType && !contentType.startsWith("image/")) {
    throw new Error(`Unexpected image content type: ${contentType}`);
  }

  const buffer = Buffer.from(await response.arrayBuffer());
  await fs.promises.writeFile(finalPath, buffer);

  return `local:${finalPath}`;
};

export const downloadImageToCache = async (
  url: string
): Promise<string | null> => {
  if (!url.startsWith("http://") && !url.startsWith("https://")) return url;

  const existing = inFlight.get(url);
  if (existing) return existing;

  const request = download(url)
    .catch((error) => {
      logger.warn("Failed to cache SteamGridDB image", { url, error });
      return null;
    })
    .finally(() => inFlight.delete(url));

  inFlight.set(url, request);
  return request;
};
