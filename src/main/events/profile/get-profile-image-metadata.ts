import fs from "node:fs";
import { fileTypeFromFile } from "file-type";
import { registerEvent } from "../register-event";

export interface ProfileImageMetadata {
  mimeType: string | null;
  isAnimated: boolean;
}

const isGifAnimated = (buffer: Buffer) => {
  if (buffer.length < 13) return false;

  let frameCount = 0;
  let offset = 13;
  const packedField = buffer[10];

  if (packedField & 0x80) {
    offset += 3 * 2 ** ((packedField & 0x07) + 1);
  }

  const skipSubBlocks = () => {
    while (offset < buffer.length) {
      const blockSize = buffer[offset];
      offset += 1;

      if (blockSize === 0) return true;

      offset += blockSize;
    }

    return false;
  };

  while (offset < buffer.length) {
    const marker = buffer[offset];
    offset += 1;

    if (marker === 0x2c) {
      frameCount += 1;
      if (frameCount > 1) return true;

      if (offset + 9 > buffer.length) return false;

      const imagePackedField = buffer[offset + 8];
      offset += 9;

      if (imagePackedField & 0x80) {
        offset += 3 * 2 ** ((imagePackedField & 0x07) + 1);
      }

      offset += 1;

      if (!skipSubBlocks()) return false;
      continue;
    }

    if (marker === 0x21) {
      offset += 1;
      if (!skipSubBlocks()) return false;
      continue;
    }

    if (marker === 0x3b) break;
  }

  return false;
};

const isWebpAnimated = (buffer: Buffer) => {
  return buffer.includes(Buffer.from("ANIM"));
};

const isPngAnimated = (buffer: Buffer) => {
  return buffer.includes(Buffer.from("acTL"));
};

const getProfileImageMetadata = async (
  _event: Electron.IpcMainInvokeEvent,
  imagePath: string
): Promise<ProfileImageMetadata> => {
  const [fileType, buffer] = await Promise.all([
    fileTypeFromFile(imagePath).catch(() => null),
    fs.promises.readFile(imagePath),
  ]);

  const mimeType = fileType?.mime ?? null;

  return {
    mimeType,
    isAnimated:
      (mimeType === "image/gif" && isGifAnimated(buffer)) ||
      (mimeType === "image/webp" && isWebpAnimated(buffer)) ||
      (mimeType === "image/png" && isPngAnimated(buffer)),
  };
};

registerEvent("getProfileImageMetadata", getProfileImageMetadata);
