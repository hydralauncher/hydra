import fs from "node:fs";
import { Transform, type Readable } from "node:stream";
import { pipeline } from "node:stream/promises";

export const MAX_ARTWORK_SIZE_IN_BYTES = 20 * 1024 * 1024;

export class ArtworkTooLargeError extends Error {
  constructor() {
    super("SteamGridDB artwork exceeds crop download limit");
  }
}

export const isArtworkTooLargeError = (
  error: unknown
): error is ArtworkTooLargeError => error instanceof ArtworkTooLargeError;

export const parseContentLength = (value: unknown): number | null => {
  if (typeof value !== "string" && typeof value !== "number") return null;

  const contentLength = Number(value);

  return Number.isSafeInteger(contentLength) && contentLength >= 0
    ? contentLength
    : null;
};

export const validateArtworkContentLength = (
  value: unknown,
  maxBytes = MAX_ARTWORK_SIZE_IN_BYTES
) => {
  const contentLength = parseContentLength(value);

  if (contentLength === 0) {
    throw new Error("Invalid SteamGridDB artwork size");
  }

  if (contentLength !== null && contentLength > maxBytes) {
    throw new ArtworkTooLargeError();
  }
};

const createArtworkSizeLimiter = (maxBytes: number) => {
  let receivedBytes = 0;

  return new Transform({
    transform(chunk: Buffer, _encoding, callback) {
      receivedBytes += chunk.length;

      if (receivedBytes > maxBytes) {
        callback(new ArtworkTooLargeError());
        return;
      }

      callback(null, chunk);
    },
  });
};

export const writeArtworkStream = async (
  source: Readable,
  destinationPath: string,
  maxBytes = MAX_ARTWORK_SIZE_IN_BYTES
) => {
  try {
    await pipeline(
      source,
      createArtworkSizeLimiter(maxBytes),
      fs.createWriteStream(destinationPath, { flags: "wx" })
    );

    const { size } = await fs.promises.stat(destinationPath);

    if (size === 0) {
      throw new Error("Invalid SteamGridDB artwork size");
    }
  } catch (error) {
    await fs.promises.unlink(destinationPath).catch(() => {});
    throw error;
  }
};
