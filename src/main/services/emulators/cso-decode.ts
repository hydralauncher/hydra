import zlib from "node:zlib";

export const CSO_MAGIC = "CISO";
export const HEADER_BYTES = 24;

const INDEX_PLAIN_FLAG = 0x80000000;
const INDEX_OFFSET_MASK = 0x7fffffff;

export interface CsoHeader {
  totalBytes: number;
  blockSize: number;
  version: number;
  indexShift: number;
  numBlocks: number;
}

export const parseCsoHeader = (raw: Buffer): CsoHeader | null => {
  if (raw.length < HEADER_BYTES) return null;
  if (raw.toString("latin1", 0, 4) !== CSO_MAGIC) return null;

  const totalBytes = Number(raw.readBigUInt64LE(8));
  const blockSize = raw.readUInt32LE(16);
  const version = raw.readUInt8(20);
  const indexShift = raw.readUInt8(21);

  if (blockSize === 0 || totalBytes === 0) return null;

  const numBlocks = Math.ceil(totalBytes / blockSize);
  return { totalBytes, blockSize, version, indexShift, numBlocks };
};

export interface CsoBlockRange {
  start: number;
  length: number;
  plain: boolean;
}

export const csoBlockRange = (
  indexRaw: Buffer,
  header: CsoHeader,
  block: number
): CsoBlockRange => {
  const entry = indexRaw.readUInt32LE(block * 4);
  const next = indexRaw.readUInt32LE((block + 1) * 4);
  const alignMul = 2 ** header.indexShift;
  const start = (entry & INDEX_OFFSET_MASK) * alignMul;
  const end = (next & INDEX_OFFSET_MASK) * alignMul;
  return {
    start,
    length: end - start,
    plain: (entry & INDEX_PLAIN_FLAG) !== 0,
  };
};

export const inflateCsoBlock = (src: Buffer): Buffer | null => {
  try {
    return zlib.inflateRawSync(src);
  } catch {
    try {
      return zlib.inflateSync(src);
    } catch {
      return null;
    }
  }
};
