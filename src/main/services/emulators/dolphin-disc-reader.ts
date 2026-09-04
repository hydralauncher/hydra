import { promises as fs } from "node:fs";
import path from "node:path";
import { inflateSync } from "node:zlib";

const DISC_HEADER_SIZE = 0x20;
const DOLPHIN_GAME_ID_LENGTH = 6;
const DOLPHIN_GAME_ID_RE = /^[A-Za-z0-9]{6}$/;

const WIA_RVZ_DISC_HEADER_OFFSET = 0x58;

const TGC_HEADER_SIZE = 0x0c;
const TGC_DISC_OFFSET_FIELD = 0x08;

const WBFS_HEADER_SIZE = 0x0d;
const WBFS_MAGIC = "WBFS";
const WBFS_SECTOR_SHIFT_FIELD = 0x09;
const WBFS_FIRST_DISC_SECTOR_FIELD = 0x0c;
const WBFS_MIN_SECTOR_SHIFT = 9;
const WBFS_MAX_SECTOR_SHIFT = 31;

const CISO_MAGIC = "CISO";
const CISO_HEADER_SIZE = 0x8000;
const CISO_BLOCK_SIZE_FIELD = 0x04;
const CISO_FIRST_BLOCK_MAP_FIELD = 0x08;
const CISO_USED_BLOCK = 1;

const GCZ_MAGIC = 0xb10bc001;
const GCZ_HEADER_SIZE = 0x20;
const GCZ_COMPRESSED_SIZE_FIELD = 0x08;
const GCZ_BLOCK_SIZE_FIELD = 0x18;
const GCZ_BLOCK_COUNT_FIELD = 0x1c;
const GCZ_BLOCK_POINTER_SIZE = 8;
const GCZ_BLOCK_HASH_SIZE = 4;
const GCZ_UNCOMPRESSED_FLAG = 1n << 63n;
const GCZ_POINTER_MASK = GCZ_UNCOMPRESSED_FLAG - 1n;
const MAX_DOLPHIN_BLOCK_SIZE = 16 * 1024 * 1024;
const GCZ_ZLIB_MARGIN = 64;

type FileHandle = import("node:fs/promises").FileHandle;

const readExact = async (
  file: FileHandle,
  length: number,
  position: number
): Promise<Buffer | null> => {
  const data = Buffer.alloc(length);
  const { bytesRead } = await file.read(data, 0, length, position);
  return bytesRead === length ? data : null;
};

const isValidBlockSize = (size: number): boolean =>
  size >= DISC_HEADER_SIZE && size <= MAX_DOLPHIN_BLOCK_SIZE;

const readRawDiscHeader = (file: FileHandle, offset = 0) =>
  readExact(file, DISC_HEADER_SIZE, offset);

const readWiaRvzDiscHeader = (file: FileHandle) =>
  readRawDiscHeader(file, WIA_RVZ_DISC_HEADER_OFFSET);

const readTgcDiscHeader = async (file: FileHandle) => {
  const header = await readExact(file, TGC_HEADER_SIZE, 0);
  if (!header) return null;

  return readRawDiscHeader(file, header.readUInt32BE(TGC_DISC_OFFSET_FIELD));
};

const readWbfsDiscHeader = async (file: FileHandle) => {
  const header = await readExact(file, WBFS_HEADER_SIZE, 0);
  if (header?.subarray(0, WBFS_MAGIC.length).toString("ascii") !== WBFS_MAGIC) {
    return null;
  }

  const sectorShift = header[WBFS_SECTOR_SHIFT_FIELD];
  const firstDiscSector = header[WBFS_FIRST_DISC_SECTOR_FIELD];
  if (
    sectorShift < WBFS_MIN_SECTOR_SHIFT ||
    sectorShift > WBFS_MAX_SECTOR_SHIFT ||
    firstDiscSector === 0
  ) {
    return null;
  }

  return readRawDiscHeader(file, firstDiscSector * 2 ** sectorShift);
};

const readCisoDiscHeader = async (file: FileHandle) => {
  const header = await readExact(file, CISO_FIRST_BLOCK_MAP_FIELD + 1, 0);
  if (header?.subarray(0, CISO_MAGIC.length).toString("ascii") !== CISO_MAGIC) {
    return null;
  }

  const blockSize = header.readUInt32LE(CISO_BLOCK_SIZE_FIELD);
  if (
    !isValidBlockSize(blockSize) ||
    header[CISO_FIRST_BLOCK_MAP_FIELD] !== CISO_USED_BLOCK
  ) {
    return null;
  }

  // Dolphin CISO is sparse, not compressed: 0 means an omitted zero block and
  // 1 means the block is stored verbatim. Logical block zero is therefore the
  // first payload block at the fixed end of the sparse map.
  return readRawDiscHeader(file, CISO_HEADER_SIZE);
};

const readGczBlockPointer = async (file: FileHandle, index: number) => {
  const pointer = await readExact(
    file,
    GCZ_BLOCK_POINTER_SIZE,
    GCZ_HEADER_SIZE + index * GCZ_BLOCK_POINTER_SIZE
  );
  return pointer?.readBigUInt64LE(0) ?? null;
};

const decodeGczFirstBlock = (
  encoded: Buffer,
  blockSize: number,
  isUncompressed: boolean
): Buffer | null => {
  if (isUncompressed) return encoded.length === blockSize ? encoded : null;

  try {
    const decoded = inflateSync(encoded, { maxOutputLength: blockSize });
    return decoded.length === blockSize ? decoded : null;
  } catch {
    return null;
  }
};

const readGczDiscHeader = async (file: FileHandle) => {
  const header = await readExact(file, GCZ_HEADER_SIZE, 0);
  if (header?.readUInt32LE(0) !== GCZ_MAGIC) return null;

  const compressedSize = header.readBigUInt64LE(GCZ_COMPRESSED_SIZE_FIELD);
  const blockSize = header.readUInt32LE(GCZ_BLOCK_SIZE_FIELD);
  const blockCount = header.readUInt32LE(GCZ_BLOCK_COUNT_FIELD);
  if (!isValidBlockSize(blockSize) || blockCount === 0) return null;

  const firstPointer = await readGczBlockPointer(file, 0);
  if (firstPointer === null) return null;

  const nextPointer =
    blockCount === 1
      ? compressedSize
      : ((await readGczBlockPointer(file, 1)) ?? 0n) & GCZ_POINTER_MASK;
  const firstOffset = firstPointer & GCZ_POINTER_MASK;
  const encodedSize = nextPointer - firstOffset;
  if (encodedSize <= 0n || encodedSize > BigInt(blockSize + GCZ_ZLIB_MARGIN)) {
    return null;
  }

  const dataOffset =
    GCZ_HEADER_SIZE +
    blockCount * (GCZ_BLOCK_POINTER_SIZE + GCZ_BLOCK_HASH_SIZE);
  const fileOffset = BigInt(dataOffset) + firstOffset;
  if (fileOffset > BigInt(Number.MAX_SAFE_INTEGER)) return null;

  const encoded = await readExact(
    file,
    Number(encodedSize),
    Number(fileOffset)
  );
  if (!encoded) return null;

  const decoded = decodeGczFirstBlock(
    encoded,
    blockSize,
    (firstPointer & GCZ_UNCOMPRESSED_FLAG) !== 0n
  );
  return decoded?.subarray(0, DISC_HEADER_SIZE) ?? null;
};

export const readDolphinDiscHeader = async (
  filePath: string
): Promise<Buffer | null> => {
  const file = await fs.open(filePath, "r").catch(() => null);
  if (!file) return null;

  try {
    const extension = path.extname(filePath).toLowerCase();
    let header: Buffer | null;
    switch (extension) {
      case ".wia":
      case ".rvz":
        header = await readWiaRvzDiscHeader(file);
        break;
      case ".tgc":
        header = await readTgcDiscHeader(file);
        break;
      case ".wbfs":
        header = await readWbfsDiscHeader(file);
        break;
      case ".ciso":
        header = await readCisoDiscHeader(file);
        break;
      case ".gcz":
        header = await readGczDiscHeader(file);
        break;
      default:
        header = await readRawDiscHeader(file);
    }
    return header;
  } finally {
    await file.close();
  }
};

export const extractDolphinGameId = async (
  filePath: string
): Promise<string | null> => {
  if (path.extname(filePath).toLowerCase() === ".wad") return null;

  const header = await readDolphinDiscHeader(filePath);
  if (!header || header.length < DOLPHIN_GAME_ID_LENGTH) return null;

  const gameId = header.subarray(0, DOLPHIN_GAME_ID_LENGTH).toString("ascii");
  return DOLPHIN_GAME_ID_RE.test(gameId) ? gameId.toUpperCase() : null;
};
