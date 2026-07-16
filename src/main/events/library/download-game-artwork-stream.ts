import fs from "node:fs";
import { Transform, type Readable } from "node:stream";
import { pipeline } from "node:stream/promises";

export const MAX_ARTWORK_SIZE_IN_BYTES = 75 * 1024 * 1024;

const invalidArtworkSizeError = () =>
  new Error("Invalid SteamGridDB artwork size");

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

  if (
    contentLength !== null &&
    (contentLength === 0 || contentLength > maxBytes)
  ) {
    throw invalidArtworkSizeError();
  }
};

const createArtworkSizeLimiter = (maxBytes: number) => {
  let receivedBytes = 0;

  return new Transform({
    transform(chunk: Buffer, _encoding, callback) {
      receivedBytes += chunk.length;

      if (receivedBytes > maxBytes) {
        callback(invalidArtworkSizeError());
        return;
      }

      callback(null, chunk);
    },
  });
};

const removePartialFile = (filePath: string) =>
  fs.promises.unlink(filePath).catch(() => {});

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

    if (size === 0 || size > maxBytes) {
      throw invalidArtworkSizeError();
    }
  } catch (error) {
    await removePartialFile(destinationPath);
    throw error;
  }
};
