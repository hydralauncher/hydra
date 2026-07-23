import { promises as fs } from "node:fs";

import type { RetroArchPlatform } from "@types";

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) {
      c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    }
    table[n] = c >>> 0;
  }
  return table;
})();

const crcUpdate = (crc: number, buffer: Buffer): number => {
  let next = crc;
  for (let i = 0; i < buffer.length; i++) {
    next = CRC_TABLE[(next ^ buffer[i]) & 0xff] ^ (next >>> 8);
  }
  return next;
};

const formatCrc = (crc: number): string =>
  ((crc ^ 0xffffffff) >>> 0).toString(16).padStart(8, "0").toUpperCase();

export const crc32 = (buffer: Buffer): string =>
  formatCrc(crcUpdate(0xffffffff, buffer));

const INES_MAGIC = Buffer.from([0x4e, 0x45, 0x53, 0x1a]);
const FDS_MAGIC = Buffer.from([0x46, 0x44, 0x53, 0x1a]);
const HEADER_SIZE = 16;
const SMC_COPIER_HEADER_SIZE = 512;

const N64_Z64_MAGIC = 0x80371240;
const N64_V64_MAGIC = 0x37804012;
const N64_N64_MAGIC = 0x40123780;

type N64ByteOrder = "z64" | "v64" | "n64";

const HASH_CHUNK_BYTES = 1024 * 1024;

const swapChunkInPlace = (chunk: Buffer, order: N64ByteOrder): void => {
  if (order === "v64") {
    for (let i = 0; i + 1 < chunk.length; i += 2) {
      const a = chunk[i];
      chunk[i] = chunk[i + 1];
      chunk[i + 1] = a;
    }
    return;
  }
  if (order === "n64") {
    for (let i = 0; i + 3 < chunk.length; i += 4) {
      const a = chunk[i];
      const b = chunk[i + 1];
      chunk[i] = chunk[i + 3];
      chunk[i + 1] = chunk[i + 2];
      chunk[i + 2] = b;
      chunk[i + 3] = a;
    }
  }
};

const resolveNormalization = (
  head: Buffer,
  headLength: number,
  fileSize: number,
  platform: RetroArchPlatform
): { skip: number; n64Order: N64ByteOrder } => {
  if (platform === "nes" && fileSize > HEADER_SIZE && headLength >= 4) {
    const magic = head.subarray(0, 4);
    if (magic.equals(INES_MAGIC) || magic.equals(FDS_MAGIC)) {
      return { skip: HEADER_SIZE, n64Order: "z64" };
    }
  }

  if (
    platform === "snes" &&
    fileSize > SMC_COPIER_HEADER_SIZE &&
    fileSize % 1024 === SMC_COPIER_HEADER_SIZE
  ) {
    return { skip: SMC_COPIER_HEADER_SIZE, n64Order: "z64" };
  }

  if (
    platform === "n64" &&
    fileSize >= 4 &&
    fileSize % 4 === 0 &&
    headLength >= 4
  ) {
    const magic = head.readUInt32BE(0);
    if (magic === N64_V64_MAGIC) return { skip: 0, n64Order: "v64" };
    if (magic === N64_N64_MAGIC) return { skip: 0, n64Order: "n64" };
    if (magic === N64_Z64_MAGIC) return { skip: 0, n64Order: "z64" };
  }

  return { skip: 0, n64Order: "z64" };
};

const readExact = async (
  handle: fs.FileHandle,
  buffer: Buffer,
  length: number,
  position: number
): Promise<number> => {
  let filled = 0;
  while (filled < length) {
    const { bytesRead } = await handle.read(
      buffer,
      filled,
      length - filled,
      position + filled
    );
    if (bytesRead <= 0) break;
    filled += bytesRead;
  }
  return filled;
};

export const hashRomFile = async (
  filePath: string,
  platform: RetroArchPlatform
): Promise<string | null> => {
  let handle: fs.FileHandle | null = null;
  try {
    handle = await fs.open(filePath, "r");
    const { size } = await handle.stat();

    const head = Buffer.alloc(HEADER_SIZE);
    const headLength = await readExact(
      handle,
      head,
      Math.min(HEADER_SIZE, size),
      0
    );

    const { skip, n64Order } = resolveNormalization(
      head,
      headLength,
      size,
      platform
    );
    const applySwap = platform === "n64" && n64Order !== "z64";

    let crc = 0xffffffff;
    let position = skip;
    const chunk = Buffer.alloc(HASH_CHUNK_BYTES);

    while (position < size) {
      const target = Math.min(HASH_CHUNK_BYTES, size - position);
      const filled = await readExact(handle, chunk, target, position);
      if (filled <= 0) break;

      const view = chunk.subarray(0, filled);
      if (applySwap) swapChunkInPlace(view, n64Order);
      crc = crcUpdate(crc, view);
      position += filled;
    }

    return formatCrc(crc);
  } catch {
    return null;
  } finally {
    await handle?.close().catch(() => {});
  }
};
