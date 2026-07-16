import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import axios from "axios";
import sharp from "sharp";

import { registerEvent } from "../register-event";
import { ASSETS_PATH } from "@main/constants";
import { logger } from "@main/services";

const POSTER_DIR = path.join(ASSETS_PATH, "cover-posters");
const POSTER_WIDTH = 400;
const POSTER_HEIGHT = 600;
const MAX_SOURCE_BYTES = 1024 * 1024 * 30;

const inflightPosters = new Map<string, Promise<string | null>>();

const hashUrl = (url: string) =>
  crypto.createHash("sha256").update(url).digest("hex").slice(0, 32);

const detectAnimatedFromHeader = (head: Buffer): boolean | null => {
  if (head.length < 16) return null;

  if (
    head.toString("ascii", 0, 4) === "RIFF" &&
    head.toString("ascii", 8, 12) === "WEBP"
  ) {
    if (head.toString("ascii", 12, 16) !== "VP8X" || head.length < 21) {
      return false;
    }
    return (head[20] & 0x02) !== 0;
  }

  if (
    head[0] === 0x89 &&
    head.toString("ascii", 1, 4) === "PNG" &&
    head.length >= 8
  ) {
    return head.includes(Buffer.from("acTL", "ascii"));
  }

  return null;
};

const downloadRange = async (url: string, endByte: number) => {
  const response = await axios.get<ArrayBuffer>(url, {
    responseType: "arraybuffer",
    headers: { Range: `bytes=0-${endByte}` },
    maxContentLength: MAX_SOURCE_BYTES,
    maxBodyLength: MAX_SOURCE_BYTES,
    validateStatus: (status) => status === 200 || status === 206,
  });

  return {
    buffer: Buffer.from(response.data),
    isPartial: response.status === 206,
  };
};

const downloadFull = async (url: string) => {
  const response = await axios.get<ArrayBuffer>(url, {
    responseType: "arraybuffer",
    maxContentLength: MAX_SOURCE_BYTES,
    maxBodyLength: MAX_SOURCE_BYTES,
  });
  return Buffer.from(response.data);
};

interface AnimatedSource {
  buffer: Buffer;
  headerAnimated: boolean | null;
}

const loadAnimatedSource = async (
  url: string
): Promise<AnimatedSource | null> => {
  if (url.startsWith("local:")) {
    const localPath = url.slice("local:".length);
    if (!fs.existsSync(localPath)) return null;
    const buffer = await fs.promises.readFile(localPath);
    return { buffer, headerAnimated: detectAnimatedFromHeader(buffer) };
  }

  if (!url.startsWith("http://") && !url.startsWith("https://")) {
    return null;
  }

  const { buffer: head, isPartial } = await downloadRange(url, 4095);
  const headerAnimated = detectAnimatedFromHeader(head);

  if (headerAnimated === false) {
    return null;
  }

  const buffer = isPartial ? await downloadFull(url) : head;
  return { buffer, headerAnimated };
};

const isAnimatedSource = async (source: AnimatedSource): Promise<boolean> => {
  if (source.headerAnimated !== null) {
    return source.headerAnimated;
  }

  const metadata = await sharp(source.buffer).metadata();
  return Boolean(metadata.pages && metadata.pages > 1);
};

const buildCoverPoster = async (url: string): Promise<string | null> => {
  const posterPath = path.join(POSTER_DIR, `${hashUrl(url)}.webp`);

  if (fs.existsSync(posterPath)) {
    return `local:${posterPath}`;
  }

  const source = await loadAnimatedSource(url).catch(() => null);
  if (!source) return null;

  if (!(await isAnimatedSource(source))) {
    return null;
  }

  await fs.promises.mkdir(POSTER_DIR, { recursive: true });

  const poster = await sharp(source.buffer, { pages: 1 })
    .resize(POSTER_WIDTH, POSTER_HEIGHT, { fit: "cover" })
    .webp({ quality: 82 })
    .toBuffer();

  await fs.promises.writeFile(posterPath, poster);

  return `local:${posterPath}`;
};

export const getCoverPoster = async (url: string): Promise<string | null> => {
  if (!url) return null;

  const existing = inflightPosters.get(url);
  if (existing) return existing;

  const request = buildCoverPoster(url)
    .catch((error) => {
      logger.warn("Failed to build cover poster", error);
      return null;
    })
    .finally(() => {
      inflightPosters.delete(url);
    });

  inflightPosters.set(url, request);
  return request;
};

const getCoverPosterEvent = async (
  _event: Electron.IpcMainInvokeEvent,
  url: string
) => getCoverPoster(url);

registerEvent("getCoverPoster", getCoverPosterEvent);
