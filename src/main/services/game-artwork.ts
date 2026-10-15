import type {
  ArtworkItem,
  ArtworkKind,
  ArtworkPage,
  GameShop,
  ShopAssets,
} from "@types";
import {
  composeEpicDefaultArtworkPages,
  preserveEpicDefaultArtwork,
} from "@shared";

import { HydraApi } from "./hydra-api";
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import axios from "axios";
import sharp from "sharp";
import { ASSETS_PATH } from "@main/constants";
import { parseCoverPosterRemoteUrl } from "../events/catalogue/cover-poster-url";

export const ARTWORK_PAGE_SIZE = 50;

const PORTRAIT_GRID_DIMENSIONS = "600x900,342x482,660x930";
const LANDSCAPE_GRID_DIMENSIONS = "460x215,920x430";
export const EPIC_ARTWORK_CACHE_DURATION_MS = 8 * 60 * 60 * 1000;
const EPIC_DEFAULT_ARTWORK_TIMEOUT_MS = 10_000;
const EPIC_DEFAULT_ARTWORK_LIMIT = 10;
export const EPIC_ICON_SIZE = 64;
const EPIC_ICON_MAX_SOURCE_BYTES = 2 * 1024 * 1024;
const EPIC_ICON_MAX_SOURCE_DIMENSION = 1024;
const EPIC_ICON_DOWNLOAD_TIMEOUT_MS = 5_000;
const EPIC_ICON_MAX_ATTEMPTS = 3;
const EPIC_ICON_MAX_OUTPUT_BYTES = 32 * 1024;
export const EPIC_ICON_CACHE_MAX_FILES = 512;
export const EPIC_ICON_CACHE_MAX_BYTES = 16 * 1024 * 1024;
const EPIC_ICON_DIRECTORY = path.join(ASSETS_PATH, "epic-icons");
const EPIC_ICON_FILENAME = /^[a-f0-9]{64}\.png$/;
const epicIconRequests = new Map<string, Promise<string>>();
let epicIconWrites = Promise.resolve();

async function validCachedEpicIcon(filename: string): Promise<boolean> {
  try {
    const stat = await fs.promises.lstat(filename);
    if (
      !stat.isFile() ||
      stat.size === 0 ||
      stat.size > EPIC_ICON_MAX_OUTPUT_BYTES
    )
      return false;
    const metadata = await sharp(filename, {
      limitInputPixels: EPIC_ICON_SIZE ** 2,
    }).metadata();
    return (
      metadata.format === "png" &&
      Boolean(
        metadata.width &&
          metadata.height &&
          metadata.width <= EPIC_ICON_SIZE &&
          metadata.height <= EPIC_ICON_SIZE &&
          (metadata.pages ?? 1) === 1
      )
    );
  } catch {
    return false;
  }
}

export async function pruneEpicIconCache(
  directory: string,
  incomingBytes: number,
  maxFiles = EPIC_ICON_CACHE_MAX_FILES,
  maxBytes = EPIC_ICON_CACHE_MAX_BYTES
) {
  if (incomingBytes > maxBytes)
    throw new Error("Epic icon exceeds the cache limit");
  const entries = await fs.promises.readdir(directory, { withFileTypes: true });
  const files = await Promise.all(
    entries
      .filter((entry) => entry.isFile() && EPIC_ICON_FILENAME.test(entry.name))
      .map(async (entry) => {
        const filename = path.join(directory, entry.name);
        const stat = await fs.promises.stat(filename);
        return { filename, bytes: stat.size, modified: stat.mtimeMs };
      })
  );
  files.sort((left, right) => left.modified - right.modified);
  let bytes = files.reduce((total, file) => total + file.bytes, 0);
  let count = files.length;
  const expired: string[] = [];
  for (const file of files) {
    if (count < maxFiles && bytes + incomingBytes <= maxBytes) break;
    expired.push(file.filename);
    bytes -= file.bytes;
    count--;
  }
  await Promise.all(expired.map((filename) => fs.promises.unlink(filename)));
}

async function preserveAvailableEpicArtwork(
  assets: ShopAssets,
  cached?: ShopAssets | null
) {
  const preserved = preserveEpicDefaultArtwork(assets, cached);
  if (!preserved.iconUrl?.startsWith("local:")) return preserved;
  const filename = path.resolve(preserved.iconUrl.slice(6));
  if (
    path.dirname(filename) !== EPIC_ICON_DIRECTORY ||
    !EPIC_ICON_FILENAME.test(path.basename(filename))
  )
    return preserved;
  if (await validCachedEpicIcon(filename)) return preserved;
  preserved.iconUrl = null;
  preserved.epicArtworkUpdatedAtByType = {
    ...preserved.epicArtworkUpdatedAtByType,
  };
  delete preserved.epicArtworkUpdatedAtByType.icon;
  return preserved;
}

async function writeEpicIcon(destination: string, buffer: Buffer) {
  const write = epicIconWrites.then(async () => {
    await fs.promises.mkdir(EPIC_ICON_DIRECTORY, { recursive: true });
    await fs.promises.rm(destination, { force: true });
    await pruneEpicIconCache(EPIC_ICON_DIRECTORY, buffer.length);
    const temporary = `${destination}.${crypto.randomUUID()}.tmp`;
    try {
      await fs.promises.writeFile(temporary, buffer, { flag: "wx" });
      await fs.promises.rename(temporary, destination);
    } finally {
      await fs.promises.rm(temporary, { force: true });
    }
  });
  // The caller receives the failure; only the queue is reset for the next write.
  epicIconWrites = write.catch(() => undefined);
  return write;
}

/** Keep larger SGDB icons out of the sidebar by caching a small PNG. */
async function cacheEpicIcon(url: URL): Promise<string> {
  const source = url.href;
  const cachedRequest = epicIconRequests.get(source);
  if (cachedRequest !== undefined) return cachedRequest;
  const pending = (async () => {
    const filename = crypto
      .createHash("sha256")
      .update(`v1:${source}`)
      .digest("hex");
    const destination = path.join(EPIC_ICON_DIRECTORY, `${filename}.png`);
    if (await validCachedEpicIcon(destination)) return `local:${destination}`;
    const response = await axios.get<ArrayBuffer>(source, {
      responseType: "arraybuffer",
      maxRedirects: 0,
      maxContentLength: EPIC_ICON_MAX_SOURCE_BYTES,
      maxBodyLength: EPIC_ICON_MAX_SOURCE_BYTES,
      timeout: EPIC_ICON_DOWNLOAD_TIMEOUT_MS,
      signal: AbortSignal.timeout(EPIC_ICON_DOWNLOAD_TIMEOUT_MS),
    });
    const image = sharp(Buffer.from(response.data), {
      limitInputPixels: EPIC_ICON_MAX_SOURCE_DIMENSION ** 2,
    });
    const metadata = await image.metadata();
    if (
      metadata.format !== "png" ||
      !metadata.width ||
      !metadata.height ||
      metadata.width > EPIC_ICON_MAX_SOURCE_DIMENSION ||
      metadata.height > EPIC_ICON_MAX_SOURCE_DIMENSION ||
      (metadata.pages ?? 1) > 1
    )
      throw new Error("Invalid Epic icon image");
    const buffer = await image
      .resize(EPIC_ICON_SIZE, EPIC_ICON_SIZE, {
        fit: "inside",
        withoutEnlargement: true,
      })
      .png()
      .toBuffer();
    if (buffer.length > EPIC_ICON_MAX_OUTPUT_BYTES)
      throw new Error("Epic icon output is too large");
    await writeEpicIcon(destination, buffer);
    return `local:${destination}`;
  })().finally(() => epicIconRequests.delete(source));
  epicIconRequests.set(source, pending);
  return pending;
}

async function resolveLargeEpicIcon(items: ArtworkItem[]) {
  const candidates = items
    .filter((item) => item && !item.nsfw && !item.humor)
    .sort((left, right) => right.score - left.score);
  const urls = candidates
    .flatMap((item) => {
      // ICO files are decoded by SGDB; their provided thumbnail is a PNG.
      const source =
        item.width === 0 && item.height === 0 ? item.thumb : item.url;
      const url = parseCoverPosterRemoteUrl(source);
      if (
        !url ||
        !(
          url.hostname === "steamgriddb.com" ||
          url.hostname.endsWith(".steamgriddb.com")
        ) ||
        !/^\/(icon|icon_thumb)\//.test(url.pathname)
      )
        return [];
      return [url];
    })
    .slice(0, EPIC_ICON_MAX_ATTEMPTS);
  const tryNext = async (
    index: number
  ): Promise<{ url: string | null; failed: boolean }> => {
    if (index >= urls.length) return { url: null, failed: urls.length > 0 };
    try {
      return { url: await cacheEpicIcon(urls[index]), failed: false };
    } catch {
      return tryNext(index + 1);
    }
  };
  return tryNext(0);
}
type EpicArtworkType = keyof NonNullable<
  ShopAssets["epicArtworkUpdatedAtByType"]
>;
const epicArtworkRequests = new Map<
  string,
  Promise<Partial<Record<EpicArtworkType, ArtworkPage>>>
>();

const KIND_PARAMS: Record<ArtworkKind, Record<string, string>> = {
  grids: {
    nsfw: "false",
    dimensions: PORTRAIT_GRID_DIMENSIONS,
    mimes: "image/png,image/jpeg,image/webp",
  },
  heroes: { nsfw: "false", mimes: "image/png,image/jpeg,image/webp" },
  logos: { nsfw: "false", mimes: "image/png,image/webp" },
  icons: { nsfw: "false", mimes: "image/png,image/vnd.microsoft.icon" },
};

interface ArtworkResponse {
  success: boolean;
  data: ArtworkItem[];
}

const emptyPage = (): ArtworkPage => ({
  items: [],
  cache: "fresh",
  hasMore: false,
});

export const fetchGameArtwork = async (
  shop: GameShop,
  objectId: string,
  kind: ArtworkKind,
  page = 0,
  parameters: Record<string, string> = {},
  timeout?: number,
  useDefaultDimensions = true
): Promise<ArtworkPage> => {
  const query: Record<string, string | number> = {
    ...KIND_PARAMS[kind],
    limit: ARTWORK_PAGE_SIZE,
    page,
    ...parameters,
  };
  if (!useDefaultDimensions) delete query.dimensions;
  const response = await HydraApi.getResponse<ArtworkResponse>(
    `/games/${shop}/${objectId}/artwork/${kind}`,
    query,
    {
      ...(timeout !== undefined && {
        timeout,
        signal: AbortSignal.timeout(timeout),
      }),
      validateStatus: (status) =>
        (status >= 200 && status < 300) || status === 404,
    }
  );

  if (response.status === 404) return emptyPage();
  if (
    timeout !== undefined &&
    (response.data?.success !== true || !Array.isArray(response.data.data))
  ) {
    throw new Error("Invalid Epic default artwork response");
  }

  const items = response.data?.data ?? [];

  return {
    items,
    cache: response.headers["x-hydra-cache"] === "stale" ? "stale" : "fresh",
    hasMore: items.length === ARTWORK_PAGE_SIZE,
  };
};

export async function resolveEpicDefaultArtwork(
  assets: ShopAssets,
  cached?: ShopAssets | null
): Promise<ShopAssets> {
  if (assets.shop !== "epic") return assets;
  const preserved = await preserveAvailableEpicArtwork(assets, cached);
  const now = Date.now();
  const isFresh = (type: EpicArtworkType) => {
    const timestamp = preserved.epicArtworkUpdatedAtByType?.[type];
    return (
      timestamp !== undefined &&
      timestamp <= now &&
      timestamp + EPIC_ARTWORK_CACHE_DURATION_MS > now
    );
  };
  if (
    ["icon", "portrait", "landscape"].every((type) =>
      isFresh(type as EpicArtworkType)
    )
  )
    return preserved;
  let pending = epicArtworkRequests.get(assets.objectId);
  if (!pending) {
    const defaults: Array<{
      type: EpicArtworkType;
      kind: ArtworkKind;
      parameters: Record<string, string>;
    }> = [
      {
        type: "icon",
        kind: "icons",
        parameters: {},
      },
      {
        type: "portrait",
        kind: "grids",
        parameters: { dimensions: PORTRAIT_GRID_DIMENSIONS, styles: "no_logo" },
      },
      {
        type: "landscape",
        kind: "grids",
        parameters: {
          dimensions: LANDSCAPE_GRID_DIMENSIONS,
          styles: "no_logo",
        },
      },
    ];
    const missing = defaults.filter(({ type }) => !isFresh(type));
    pending = Promise.allSettled(
      missing.map(async ({ type, kind, parameters }) => {
        const startedAt = Date.now();
        const query = {
          types: "static",
          limit: String(EPIC_DEFAULT_ARTWORK_LIMIT),
          humor: "false",
          epilepsy: "false",
          ...parameters,
        };
        const page = await fetchGameArtwork(
          "epic",
          assets.objectId,
          kind,
          0,
          query,
          EPIC_DEFAULT_ARTWORK_TIMEOUT_MS
        );
        if (
          kind !== "grids" ||
          page.items.some(
            (item) =>
              item.style === "no_logo" &&
              !item.nsfw &&
              !item.humor &&
              /^https:\/\//i.test(item.url) &&
              (type === "portrait"
                ? item.height > item.width
                : item.width > item.height)
          )
        )
          return page;
        // A game may only have no-logo grids outside the preferred dimensions.
        // Keep the style filter and let the resolver validate the aspect ratio.
        const fallback: Record<string, string> = {
          ...query,
          limit: String(ARTWORK_PAGE_SIZE),
        };
        delete fallback.dimensions;
        const remaining =
          EPIC_DEFAULT_ARTWORK_TIMEOUT_MS - (Date.now() - startedAt);
        if (remaining <= 0) throw new Error("Epic default artwork timed out");
        return fetchGameArtwork(
          "epic",
          assets.objectId,
          kind,
          0,
          fallback,
          remaining,
          false
        );
      })
    )
      .then((responses) => {
        const pages: Partial<Record<EpicArtworkType, ArtworkPage>> = {};
        responses.forEach((response, index) => {
          if (response.status === "fulfilled")
            pages[missing[index].type] = response.value;
        });
        return pages;
      })
      .finally(() => epicArtworkRequests.delete(assets.objectId));
    epicArtworkRequests.set(assets.objectId, pending);
  }
  const pages = await pending;
  return finishEpicDefaultArtwork(preserved, pages);
}

async function finishEpicDefaultArtwork(
  preserved: ShopAssets,
  pages: Partial<Record<EpicArtworkType, ArtworkPage>>
) {
  const artwork = composeEpicDefaultArtworkPages(
    preserved,
    {
      ...(pages.icon && { icon: pages.icon.items }),
      ...(pages.portrait && { portrait: pages.portrait.items }),
      ...(pages.landscape && { landscape: pages.landscape.items }),
    },
    Date.now()
  );
  if (!pages.icon || artwork.iconUrl) return artwork;
  const icon = await resolveLargeEpicIcon(pages.icon.items);
  if (icon.url) artwork.iconUrl = icon.url;
  else if (icon.failed) {
    // A download failure must be retried rather than cached as absent for eight hours.
    artwork.iconUrl = preserved.iconUrl;
    if (artwork.epicArtworkUpdatedAtByType) {
      if (preserved.epicArtworkUpdatedAtByType?.icon !== undefined)
        artwork.epicArtworkUpdatedAtByType.icon =
          preserved.epicArtworkUpdatedAtByType.icon;
      else delete artwork.epicArtworkUpdatedAtByType.icon;
    }
  }
  return artwork;
}
