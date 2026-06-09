import fs from "node:fs";
import path from "node:path";
import { fileTypeFromFile } from "file-type";
import sharp from "sharp";
import { registerEvent } from "../register-event";

export interface ProfileImageMetadata {
  mimeType: string | null;
  isAnimated: boolean;
}

const HEADER_BYTES = 256 * 1024;
const PNG_SIGNATURE = Buffer.from([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
]);
const WEBP_ANIMATION_FLAG = 0x02;

const MIME_BY_EXTENSION: Record<string, string> = {
  ".apng": "image/apng",
  ".gif": "image/gif",
  ".png": "image/png",
  ".webp": "image/webp",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
};

const getMimeType = async (imagePath: string) => {
  const fileType = await fileTypeFromFile(imagePath).catch(() => null);

  return (
    fileType?.mime ??
    MIME_BY_EXTENSION[path.extname(imagePath).toLowerCase()] ??
    null
  );
};

const readHeader = async (imagePath: string) => {
  const handle = await fs.promises.open(imagePath, "r");

  try {
    const buffer = Buffer.alloc(HEADER_BYTES);
    const { bytesRead } = await handle.read(buffer, 0, HEADER_BYTES, 0);

    return buffer.subarray(0, bytesRead);
  } finally {
    await handle.close();
  }
};

const skipGifSubBlocks = (buffer: Buffer, offset: number) => {
  let nextOffset = offset;

  while (nextOffset < buffer.length) {
    const blockSize = buffer[nextOffset];
    nextOffset += 1;

    if (blockSize === 0) return nextOffset;

    nextOffset += blockSize;
  }

  return null;
};

const isGifAnimated = (buffer: Buffer): boolean | null => {
  if (buffer.length < 13) return null;

  let frameCount = 0;
  let offset = 13;
  const packedField = buffer[10];

  if (packedField & 0x80) {
    offset += 3 * 2 ** ((packedField & 0x07) + 1);
  }

  while (offset < buffer.length) {
    const marker = buffer[offset];
    offset += 1;

    if (marker === 0x2c) {
      frameCount += 1;
      if (frameCount > 1) return true;
      if (offset + 9 > buffer.length) return null;

      const imagePackedField = buffer[offset + 8];
      offset += 9;

      if (imagePackedField & 0x80) {
        offset += 3 * 2 ** ((imagePackedField & 0x07) + 1);
      }

      const nextOffset = skipGifSubBlocks(buffer, offset + 1);
      if (nextOffset === null) return null;

      offset = nextOffset;
    } else if (marker === 0x21) {
      const nextOffset = skipGifSubBlocks(buffer, offset + 1);
      if (nextOffset === null) return null;

      offset = nextOffset;
    } else if (marker === 0x3b) {
      return false;
    } else {
      return null;
    }
  }

  return null;
};

const isWebpAnimated = (buffer: Buffer): boolean | null => {
  if (buffer.length < 21) return null;
  if (buffer.toString("ascii", 0, 4) !== "RIFF") return false;
  if (buffer.toString("ascii", 8, 12) !== "WEBP") return false;

  let offset = 12;

  while (offset + 8 <= buffer.length) {
    const chunkType = buffer.toString("ascii", offset, offset + 4);
    const chunkSize = buffer.readUInt32LE(offset + 4);
    const chunkDataOffset = offset + 8;

    if (chunkType === "VP8X") {
      return (
        chunkDataOffset < buffer.length &&
        (buffer[chunkDataOffset] & WEBP_ANIMATION_FLAG) !== 0
      );
    }

    if (chunkType === "ANIM") return true;

    offset = chunkDataOffset + chunkSize + (chunkSize % 2);
  }

  return null;
};

const isPngAnimated = (buffer: Buffer): boolean | null => {
  if (buffer.length < PNG_SIGNATURE.length + 12) return null;
  if (!buffer.subarray(0, PNG_SIGNATURE.length).equals(PNG_SIGNATURE))
    return false;

  let offset = PNG_SIGNATURE.length;

  while (offset + 12 <= buffer.length) {
    const chunkSize = buffer.readUInt32BE(offset);
    const chunkType = buffer.toString("ascii", offset + 4, offset + 8);

    if (chunkType === "acTL") return true;
    if (chunkType === "IDAT" || chunkType === "IEND") return false;

    offset += 12 + chunkSize;
  }

  return null;
};

const canBeAnimated = (mimeType: string | null) => {
  return (
    mimeType === "image/gif" ||
    mimeType === "image/apng" ||
    mimeType === "image/webp" ||
    mimeType === "image/png"
  );
};

const detectAnimationFromHeader = (mimeType: string | null, buffer: Buffer) => {
  if (mimeType === "image/gif") return isGifAnimated(buffer);
  if (mimeType === "image/webp") return isWebpAnimated(buffer);
  if (mimeType === "image/apng" || mimeType === "image/png") {
    return isPngAnimated(buffer);
  }

  return false;
};

const detectAnimation = async (mimeType: string | null, imagePath: string) => {
  const metadata = await sharp(imagePath, { animated: true }).metadata();

  if (metadata.pages) return metadata.pages > 1;

  return (
    detectAnimationFromHeader(mimeType, await readHeader(imagePath)) ?? true
  );
};

const getProfileImageMetadata = async (
  _event: Electron.IpcMainInvokeEvent,
  imagePath: string
): Promise<ProfileImageMetadata> => {
  const mimeType = await getMimeType(imagePath);

  if (!canBeAnimated(mimeType)) {
    return { mimeType, isAnimated: false };
  }

  try {
    return {
      mimeType,
      isAnimated: await detectAnimation(mimeType, imagePath),
    };
  } catch {
    return { mimeType, isAnimated: true };
  }
};

registerEvent("getProfileImageMetadata", getProfileImageMetadata);
