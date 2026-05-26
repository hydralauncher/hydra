import axios from "axios";
import { JSDOM } from "jsdom";
import UserAgent from "user-agents";
import path from "node:path";
import fs from "node:fs";
import { THEMES_PATH } from "@main/constants";

export const getFileBuffer = async (url: string) =>
  fetch(url, { method: "GET" }).then((response) =>
    response.arrayBuffer().then((buffer) => Buffer.from(buffer))
  );

export const sleep = (ms: number) =>
  new Promise((resolve) => setTimeout(resolve, ms));

export const requestWebPage = async (url: string) => {
  const userAgent = new UserAgent();

  const data = await axios
    .get(url, {
      headers: {
        "User-Agent": userAgent.toString(),
      },
    })
    .then((response) => response.data);

  const { window } = new JSDOM(data);
  return window.document;
};

export const isPortableVersion = () => {
  return !!process.env.PORTABLE_EXECUTABLE_FILE;
};

export const normalizePath = (str: string) =>
  path.posix.normalize(str).replaceAll("\\", "/");

export const addTrailingSlash = (str: string) =>
  str.endsWith("/") ? str : `${str}/`;

const sanitizeFolderName = (name: string): string => {
  return name
    .toLowerCase()
    .replaceAll(/[^a-z0-9-_\s]/g, "")
    .replaceAll(/\s+/g, "-")
    .replaceAll(/-+/g, "-")
    .replaceAll(/(^-|-$)/g, "");
};

export const themeSoundFormats = ["wav", "mp3", "ogg", "m4a"] as const;
export type ThemeSoundFormat = (typeof themeSoundFormats)[number];

export const getThemeSoundFormat = (
  filePath: string
): ThemeSoundFormat | null => {
  const extension = path.extname(filePath).toLowerCase().slice(1);

  return themeSoundFormats.includes(extension as ThemeSoundFormat)
    ? (extension as ThemeSoundFormat)
    : null;
};

const isValidWavBuffer = (buffer: Buffer): boolean => {
  if (
    buffer.length < 44 ||
    buffer.subarray(0, 4).toString("ascii") !== "RIFF" ||
    buffer.subarray(8, 12).toString("ascii") !== "WAVE"
  ) {
    return false;
  }

  const riffSize = buffer.readUInt32LE(4);
  const riffEnd = riffSize + 8;
  if (riffSize < 36 || riffEnd > buffer.length) {
    return false;
  }

  let hasFormatChunk = false;
  let hasDataChunk = false;
  let offset = 12;

  while (offset + 8 <= riffEnd) {
    const chunkId = buffer.subarray(offset, offset + 4).toString("ascii");
    const chunkSize = buffer.readUInt32LE(offset + 4);
    const chunkStart = offset + 8;
    const chunkEnd = chunkStart + chunkSize;

    if (chunkEnd > riffEnd) {
      return false;
    }

    if (chunkId === "fmt " && chunkSize >= 16) {
      hasFormatChunk = true;
    }

    if (chunkId === "data" && chunkSize > 0) {
      hasDataChunk = true;
    }

    if (hasFormatChunk && hasDataChunk) {
      return true;
    }

    offset = chunkEnd + (chunkSize % 2);
  }

  return false;
};

const parseId3TagSize = (buffer: Buffer): number | null => {
  if (buffer.length < 10 || buffer.subarray(0, 3).toString("ascii") !== "ID3") {
    return null;
  }

  const majorVersion = buffer[3];
  if (majorVersion < 2 || majorVersion > 4 || buffer[4] === 0xff) {
    return null;
  }

  if (
    (buffer[6] & 0x80) !== 0 ||
    (buffer[7] & 0x80) !== 0 ||
    (buffer[8] & 0x80) !== 0 ||
    (buffer[9] & 0x80) !== 0
  ) {
    return null;
  }

  const tagSize =
    ((buffer[6] & 0x7f) << 21) |
    ((buffer[7] & 0x7f) << 14) |
    ((buffer[8] & 0x7f) << 7) |
    (buffer[9] & 0x7f);
  const footerSize = (buffer[5] & 0x10) === 0x10 ? 10 : 0;

  return 10 + tagSize + footerSize;
};

const mp3Bitrates: Record<number, Record<number, number[]>> = {
  3: {
    3: [0, 32, 64, 96, 128, 160, 192, 224, 256, 288, 320, 352, 384, 416, 448],
    2: [0, 32, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320, 384],
    1: [0, 32, 40, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320],
  },
  2: {
    3: [0, 32, 48, 56, 64, 80, 96, 112, 128, 144, 160, 176, 192, 224, 256],
    2: [0, 8, 16, 24, 32, 40, 48, 56, 64, 80, 96, 112, 128, 144, 160],
    1: [0, 8, 16, 24, 32, 40, 48, 56, 64, 80, 96, 112, 128, 144, 160],
  },
  0: {
    3: [0, 32, 48, 56, 64, 80, 96, 112, 128, 144, 160, 176, 192, 224, 256],
    2: [0, 8, 16, 24, 32, 40, 48, 56, 64, 80, 96, 112, 128, 144, 160],
    1: [0, 8, 16, 24, 32, 40, 48, 56, 64, 80, 96, 112, 128, 144, 160],
  },
};

const mp3SampleRates: Record<number, number[]> = {
  3: [44100, 48000, 32000],
  2: [22050, 24000, 16000],
  0: [11025, 12000, 8000],
};

const getMp3FrameLength = (buffer: Buffer, offset: number): number | null => {
  if (offset + 4 > buffer.length || buffer[offset] !== 0xff) {
    return null;
  }

  const secondByte = buffer[offset + 1];
  if ((secondByte & 0xe0) !== 0xe0) {
    return null;
  }

  const version = (secondByte >> 3) & 0x03;
  const layer = (secondByte >> 1) & 0x03;
  const bitrateIndex = buffer[offset + 2] >> 4;
  const sampleRateIndex = (buffer[offset + 2] >> 2) & 0x03;
  const padding = (buffer[offset + 2] >> 1) & 0x01;
  const emphasis = buffer[offset + 3] & 0x03;

  if (
    version === 1 ||
    layer === 0 ||
    bitrateIndex === 0 ||
    bitrateIndex === 0x0f ||
    sampleRateIndex === 0x03 ||
    emphasis === 0x02
  ) {
    return null;
  }

  const bitrate = mp3Bitrates[version][layer][bitrateIndex] * 1000;
  const sampleRate = mp3SampleRates[version][sampleRateIndex];

  if (!bitrate || !sampleRate) {
    return null;
  }

  if (layer === 3) {
    return Math.floor((12 * bitrate) / sampleRate + padding) * 4;
  }

  const coefficient = layer === 1 && version !== 3 ? 72 : 144;
  return Math.floor((coefficient * bitrate) / sampleRate + padding);
};

const hasCompleteMp3Frame = (buffer: Buffer, offset: number): boolean => {
  const frameLength = getMp3FrameLength(buffer, offset);

  return (
    frameLength !== null &&
    frameLength > 4 &&
    offset + frameLength <= buffer.length
  );
};

const isValidMp3Buffer = (buffer: Buffer): boolean => {
  if (hasCompleteMp3Frame(buffer, 0)) {
    return true;
  }

  const id3TagSize = parseId3TagSize(buffer);
  if (id3TagSize === null || id3TagSize >= buffer.length) {
    return false;
  }

  const scanLimit = Math.min(buffer.length - 4, id3TagSize + 4096);
  for (let offset = id3TagSize; offset <= scanLimit; offset++) {
    if (hasCompleteMp3Frame(buffer, offset)) {
      return true;
    }
  }

  return false;
};

const isValidOggBuffer = (buffer: Buffer): boolean => {
  if (
    buffer.length < 28 ||
    buffer.subarray(0, 4).toString("ascii") !== "OggS" ||
    buffer[4] !== 0
  ) {
    return false;
  }

  const pageSegments = buffer[26];
  const headerLength = 27 + pageSegments;
  if (pageSegments === 0 || headerLength > buffer.length) {
    return false;
  }

  let bodyLength = 0;
  for (let offset = 27; offset < headerLength; offset++) {
    bodyLength += buffer[offset];
  }

  const bodyStart = headerLength;
  const bodyEnd = bodyStart + bodyLength;
  if (bodyLength === 0 || bodyEnd > buffer.length) {
    return false;
  }

  const body = buffer.subarray(bodyStart, bodyEnd);

  return (
    body.subarray(0, 8).toString("ascii") === "OpusHead" ||
    body
      .subarray(0, 7)
      .equals(Buffer.from([0x01, 0x76, 0x6f, 0x72, 0x62, 0x69, 0x73])) ||
    body.subarray(0, 8).toString("ascii") === "Speex   " ||
    body.subarray(0, 5).equals(Buffer.from([0x7f, 0x46, 0x4c, 0x41, 0x43]))
  );
};

const isValidM4aBuffer = (buffer: Buffer): boolean => {
  if (buffer.length < 24) {
    return false;
  }

  let offset = 0;
  let hasFileTypeBox = false;
  let hasMovieBox = false;
  let hasMediaDataBox = false;

  while (offset + 8 <= buffer.length) {
    const size = buffer.readUInt32BE(offset);
    const type = buffer.subarray(offset + 4, offset + 8).toString("ascii");
    let boxHeaderSize = 8;
    let boxSize = size;

    if (size === 1) {
      if (offset + 16 > buffer.length) {
        return false;
      }

      const largeSize = buffer.readBigUInt64BE(offset + 8);
      if (largeSize > BigInt(Number.MAX_SAFE_INTEGER)) {
        return false;
      }

      boxHeaderSize = 16;
      boxSize = Number(largeSize);
    } else if (size === 0) {
      boxSize = buffer.length - offset;
    }

    if (boxSize < boxHeaderSize || offset + boxSize > buffer.length) {
      return false;
    }

    if (offset === 0) {
      if (type !== "ftyp" || boxSize < 16) {
        return false;
      }

      hasFileTypeBox = true;
    }

    if (type === "mdat" && boxSize > boxHeaderSize) {
      hasMediaDataBox = true;
    }

    if (type === "moov" && boxSize > boxHeaderSize) {
      hasMovieBox = true;
    }

    if (hasFileTypeBox && hasMovieBox && hasMediaDataBox) {
      return true;
    }

    offset += boxSize;
  }

  return false;
};

export const isValidThemeSoundBuffer = (
  buffer: Buffer,
  format: ThemeSoundFormat
): boolean => {
  if (!buffer.length) return false;

  switch (format) {
    case "wav":
      return isValidWavBuffer(buffer);

    case "mp3":
      return isValidMp3Buffer(buffer);

    case "ogg":
      return isValidOggBuffer(buffer);

    case "m4a":
      return isValidM4aBuffer(buffer);
  }
};

export const isValidThemeSoundFile = (filePath: string): boolean => {
  const format = getThemeSoundFormat(filePath);
  if (!format) return false;

  try {
    return isValidThemeSoundBuffer(fs.readFileSync(filePath), format);
  } catch {
    return false;
  }
};

export const removeThemeSoundFiles = async (
  themeDir: string
): Promise<void> => {
  await Promise.all(
    themeSoundFormats.map(async (format) => {
      const soundPath = path.join(themeDir, `achievement.${format}`);

      if (fs.existsSync(soundPath)) {
        await fs.promises.unlink(soundPath);
      }
    })
  );
};

export const getThemePath = (themeId: string, themeName?: string): string => {
  if (themeName) {
    const sanitizedName = sanitizeFolderName(themeName);
    if (sanitizedName) {
      return path.join(THEMES_PATH, sanitizedName);
    }
  }
  return path.join(THEMES_PATH, themeId);
};

export const getThemeSoundPath = (
  themeId: string,
  themeName?: string
): string | null => {
  const themeDir = getThemePath(themeId, themeName);
  const legacyThemeDir = themeName ? path.join(THEMES_PATH, themeId) : null;

  const checkDir = (dir: string): string | null => {
    if (!fs.existsSync(dir)) {
      return null;
    }

    for (const format of themeSoundFormats) {
      const soundPath = path.join(dir, `achievement.${format}`);
      if (fs.existsSync(soundPath) && isValidThemeSoundFile(soundPath)) {
        return soundPath;
      }
    }

    return null;
  };

  const soundPath = checkDir(themeDir);
  if (soundPath) {
    return soundPath;
  }

  if (legacyThemeDir) {
    return checkDir(legacyThemeDir);
  }

  return null;
};

export * from "./reg-parser";
export * from "./launch-game";
export * from "./download-error-handler";
export * from "./download-game-helper";
