import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { net } from "electron";
import sharp from "sharp";

import { ASSETS_PATH } from "@main/constants";
import {
  COVER_THUMBNAIL_WIDTHS,
  parseCoverThumbnailUrl,
  type CoverThumbnailWidth,
} from "@shared";
import { logger } from "./logger";
import { getBrowserUserAgent } from "@main/helpers/browser-user-agent";

sharp.cache(false);
sharp.concurrency(1);

const THUMBNAIL_DIR = path.join(ASSETS_PATH, "cover-thumbnails");
const THUMBNAIL_VERSION = "v1";
const MAX_SOURCE_BYTES = 64 * 1024 * 1024;
const MAX_CONCURRENT_BUILDS = 6;
const MAX_CONCURRENT_RESIZES = 2;
const SOURCE_TIMEOUT_MS = 10_000;
const FAILED_SOURCE_RETRY_MS = 10 * 60 * 1000;
const MISSING_SOURCE_TTL_MS = 24 * 60 * 60 * 1000;
const MISSING_SOURCE_STATUSES = new Set([403, 404, 410]);
const MISSING_SOURCES_PATH = path.join(THUMBNAIL_DIR, "missing-sources.json");
const failedSources = new Map<string, number>();
const PREFETCH_WORKERS = 2;
const MISSING_SOURCES_SAVE_DELAY_MS = 2000;
const THUMBNAIL_WEBP_QUALITY = 82;
const THUMBNAIL_HEADERS = {
  "content-type": "image/webp",
  "cache-control": "public, max-age=31536000, immutable",
};

interface ThumbnailResult {
  buffer: Buffer;
  contentType: string;
}

const inflightBuilds = new Map<string, Promise<ThumbnailResult | null>>();
const priorityQueue: (() => void)[] = [];
const backgroundQueue: (() => void)[] = [];
let activeBuilds = 0;
let activeResizes = 0;
const resizeQueue: (() => void)[] = [];

const acquireResizeSlot = () =>
  new Promise<void>((resolve) => {
    if (activeResizes < MAX_CONCURRENT_RESIZES) {
      activeResizes++;
      resolve();
      return;
    }

    resizeQueue.push(resolve);
  });

const releaseResizeSlot = () => {
  const next = resizeQueue.shift();
  if (next) {
    next();
  } else {
    activeResizes--;
  }
};

let missingSourcesLoad: Promise<Map<string, number>> | null = null;
let saveMissingSourcesTimer: NodeJS.Timeout | null = null;

const loadMissingSources = () => {
  missingSourcesLoad ??= fs.promises
    .readFile(MISSING_SOURCES_PATH, "utf8")
    .then((raw) => {
      const now = Date.now();
      const entries = Object.entries(
        JSON.parse(raw) as Record<string, unknown>
      ).filter(
        (entry): entry is [string, number] =>
          typeof entry[1] === "number" && now - entry[1] < MISSING_SOURCE_TTL_MS
      );
      return new Map(entries);
    })
    .catch(() => new Map<string, number>());
  return missingSourcesLoad;
};

const saveMissingSources = (missingSources: Map<string, number>) => {
  if (saveMissingSourcesTimer) return;

  saveMissingSourcesTimer = setTimeout(() => {
    saveMissingSourcesTimer = null;
    void fs.promises
      .mkdir(THUMBNAIL_DIR, { recursive: true })
      .then(() =>
        fs.promises.writeFile(
          MISSING_SOURCES_PATH,
          JSON.stringify(Object.fromEntries(missingSources))
        )
      )
      .catch(() => {});
  }, MISSING_SOURCES_SAVE_DELAY_MS);
};

const rememberMissingSource = async (source: string) => {
  const missingSources = await loadMissingSources();
  missingSources.set(source, Date.now());
  saveMissingSources(missingSources);
};

const isUnavailableSource = async (source: string) => {
  const failedAt = failedSources.get(source);
  if (failedAt && Date.now() - failedAt < FAILED_SOURCE_RETRY_MS) return true;

  const missingAt = (await loadMissingSources()).get(source);
  return (
    missingAt !== undefined && Date.now() - missingAt < MISSING_SOURCE_TTL_MS
  );
};

const acquireSlot = (priority: "high" | "low") =>
  new Promise<void>((resolve) => {
    if (activeBuilds < MAX_CONCURRENT_BUILDS) {
      activeBuilds++;
      resolve();
      return;
    }

    (priority === "high" ? priorityQueue : backgroundQueue).push(resolve);
  });

const releaseSlot = () => {
  const next = priorityQueue.pop() ?? backgroundQueue.shift();
  if (next) {
    next();
  } else {
    activeBuilds--;
  }
};

const getThumbnailPath = (source: string, width: CoverThumbnailWidth) => {
  const hash = crypto
    .createHash("sha256")
    .update(source)
    .digest("hex")
    .slice(0, 32);
  return path.join(THUMBNAIL_DIR, `${hash}-${width}-${THUMBNAIL_VERSION}.webp`);
};

const readCachedThumbnail = (thumbnailPath: string) =>
  fs.promises.readFile(thumbnailPath).catch(() => null);

const resolveLocalSourcePath = async (source: string) => {
  const rawPath = source.slice("local:".length);
  const decodedPath = (() => {
    try {
      return decodeURI(rawPath);
    } catch {
      return rawPath;
    }
  })();
  const candidates =
    decodedPath === rawPath ? [rawPath] : [rawPath, decodedPath];

  for (const candidate of candidates) {
    const stats = await fs.promises.stat(candidate).catch(() => null);
    if (stats?.isFile() && stats.size > 0 && stats.size <= MAX_SOURCE_BYTES) {
      return candidate;
    }
  }

  return null;
};

const readSource = async (source: string): Promise<ThumbnailResult | null> => {
  if (source.startsWith("local:")) {
    const filePath = await resolveLocalSourcePath(source);
    if (!filePath) return null;

    return {
      buffer: await fs.promises.readFile(filePath),
      contentType: "application/octet-stream",
    };
  }

  const response = await net.fetch(source, {
    headers: { "user-agent": getBrowserUserAgent() },
    signal: AbortSignal.timeout(SOURCE_TIMEOUT_MS),
  });
  if (!response.ok) {
    logger.warn("Cover thumbnail source unavailable", {
      source,
      status: response.status,
    });
    if (MISSING_SOURCE_STATUSES.has(response.status)) {
      void rememberMissingSource(source);
    }
    return null;
  }

  const declaredLength = Number(response.headers.get("content-length"));
  if (declaredLength > MAX_SOURCE_BYTES) {
    logger.warn("Cover thumbnail source too large", { source, declaredLength });
    return null;
  }

  const buffer = Buffer.from(await response.arrayBuffer());
  if (buffer.length === 0 || buffer.length > MAX_SOURCE_BYTES) {
    logger.warn("Cover thumbnail source has invalid size", {
      source,
      size: buffer.length,
    });
    return null;
  }

  return {
    buffer,
    contentType:
      response.headers.get("content-type") ?? "application/octet-stream",
  };
};

const writeThumbnail = async (thumbnailPath: string, buffer: Buffer) => {
  await fs.promises.mkdir(THUMBNAIL_DIR, { recursive: true });

  const tempPath = `${thumbnailPath}.${process.pid}.${Date.now()}.tmp`;
  await fs.promises.writeFile(tempPath, buffer);
  await fs.promises.rename(tempPath, thumbnailPath).catch(async () => {
    await fs.promises.rm(tempPath, { force: true });
  });
};

const buildThumbnail = async (
  source: string,
  width: CoverThumbnailWidth,
  thumbnailPath: string
): Promise<ThumbnailResult | null> => {
  const original = await readSource(source).catch((error) => {
    logger.warn("Failed to download cover for thumbnail", {
      source,
      error: error instanceof Error ? error.message : String(error),
    });
    return null;
  });
  if (!original) {
    failedSources.set(source, Date.now());
    return null;
  }
  failedSources.delete(source);

  await acquireResizeSlot();
  try {
    const thumbnail = await sharp(original.buffer, { pages: 1 })
      .resize({ width, withoutEnlargement: true })
      .webp({ quality: THUMBNAIL_WEBP_QUALITY })
      .toBuffer();
    releaseResizeSlot();

    await writeThumbnail(thumbnailPath, thumbnail).catch((error) => {
      logger.warn("Failed to write cover thumbnail", error);
    });

    return { buffer: thumbnail, contentType: "image/webp" };
  } catch (error) {
    releaseResizeSlot();
    logger.warn("Failed to build cover thumbnail", {
      source,
      error: error instanceof Error ? error.message : String(error),
    });
    return original;
  }
};

const ensureThumbnail = (
  source: string,
  width: CoverThumbnailWidth,
  priority: "high" | "low"
): Promise<ThumbnailResult | null> => {
  const thumbnailPath = getThumbnailPath(source, width);

  const existing = inflightBuilds.get(thumbnailPath);
  if (existing !== undefined) return existing;

  const build = (async () => {
    const cached = await readCachedThumbnail(thumbnailPath);
    if (cached) return { buffer: cached, contentType: "image/webp" };
    if (await isUnavailableSource(source)) return null;

    await acquireSlot(priority);
    try {
      return await buildThumbnail(source, width, thumbnailPath);
    } finally {
      releaseSlot();
    }
  })().finally(() => {
    inflightBuilds.delete(thumbnailPath);
  });

  inflightBuilds.set(thumbnailPath, build);
  return build;
};

const readLargerCachedThumbnail = async (
  source: string,
  width: CoverThumbnailWidth
) => {
  for (const largerWidth of COVER_THUMBNAIL_WIDTHS) {
    if (largerWidth <= width) continue;
    const cached = await readCachedThumbnail(
      getThumbnailPath(source, largerWidth)
    );
    if (cached) return cached;
  }
  return null;
};

export const handleCoverThumbnailRequest = async (
  request: Request
): Promise<Response> => {
  const parsed = parseCoverThumbnailUrl(request.url);
  if (!parsed) {
    logger.warn("Rejected cover thumbnail request", { url: request.url });
    return new Response(null, { status: 400 });
  }

  try {
    const thumbnailPath = getThumbnailPath(parsed.source, parsed.width);
    const cached = await readCachedThumbnail(thumbnailPath);
    if (cached) {
      return new Response(new Uint8Array(cached), {
        headers: THUMBNAIL_HEADERS,
      });
    }

    const larger = await readLargerCachedThumbnail(parsed.source, parsed.width);
    if (larger) {
      void ensureThumbnail(parsed.source, parsed.width, "low").catch(
        () => null
      );
      return new Response(new Uint8Array(larger), {
        headers: THUMBNAIL_HEADERS,
      });
    }

    const result = await ensureThumbnail(parsed.source, parsed.width, "high");
    if (!result) return new Response(null, { status: 404 });

    return new Response(new Uint8Array(result.buffer), {
      headers:
        result.contentType === "image/webp"
          ? THUMBNAIL_HEADERS
          : { "content-type": result.contentType },
    });
  } catch (error) {
    logger.warn("Cover thumbnail request failed", {
      source: parsed.source,
      error: error instanceof Error ? error.message : String(error),
    });
    return new Response(null, { status: 500 });
  }
};

let prefetchQueue: { source: string; width: CoverThumbnailWidth }[] = [];
let activePrefetchWorkers = 0;

const runPrefetchWorker = async () => {
  activePrefetchWorkers++;
  try {
    let next = prefetchQueue.shift();
    while (next) {
      const isCached = await fs.promises
        .access(getThumbnailPath(next.source, next.width))
        .then(() => true)
        .catch(() => false);

      if (!isCached) {
        await ensureThumbnail(next.source, next.width, "low").catch(() => null);
      }

      next = prefetchQueue.shift();
    }
  } finally {
    activePrefetchWorkers--;
  }
};

export const prefetchCoverThumbnails = (thumbnailUrls: string[]) => {
  const seen = new Set<string>();

  prefetchQueue = thumbnailUrls.flatMap((thumbnailUrl) => {
    const parsed = parseCoverThumbnailUrl(thumbnailUrl);
    if (!parsed) return [];

    const key = `${parsed.width}:${parsed.source}`;
    if (seen.has(key)) return [];
    seen.add(key);

    return [parsed];
  });

  while (activePrefetchWorkers < PREFETCH_WORKERS && prefetchQueue.length) {
    void runPrefetchWorker();
  }
};
