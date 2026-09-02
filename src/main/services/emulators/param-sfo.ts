import { normalize } from "./sku-normalize.js";

const findKeyOffset = (
  data: Buffer,
  keyTableStart: number,
  keyOffset: number
): { key: string; nextNull: number } => {
  const start = keyTableStart + keyOffset;
  const nextNull = data.indexOf(0, start);
  const end = nextNull === -1 ? data.length : nextNull;
  return { key: data.subarray(start, end).toString("ascii"), nextNull: end };
};

export const parseParamSfoValue = (
  data: Buffer,
  requestedKey: string
): string | null => {
  if (data.length < 20) return null;
  if (data.readUInt32LE(0) !== 0x46535000) return null;

  const keyTableStart = data.readUInt32LE(8);
  const dataTableStart = data.readUInt32LE(12);
  const numEntries = data.readUInt32LE(16);
  const indexStart = 20;

  for (let i = 0; i < numEntries; i++) {
    const off = indexStart + i * 16;
    if (off + 16 > data.length) break;

    const keyOffset = data.readUInt16LE(off);
    const dataUsedSize = data.readUInt32LE(off + 4);
    const dataOffset = data.readUInt32LE(off + 12);

    const { key } = findKeyOffset(data, keyTableStart, keyOffset);
    if (key === requestedKey) {
      const valueStart = dataTableStart + dataOffset;
      const valueEnd = valueStart + dataUsedSize;
      if (valueEnd > data.length) return null;
      const decoded = data.subarray(valueStart, valueEnd).toString("ascii");
      const nullOffset = decoded.indexOf("\0");
      const raw = (
        nullOffset === -1 ? decoded : decoded.slice(0, nullOffset)
      ).trim();
      return raw.length > 0 ? normalize(raw) : null;
    }
  }
  return null;
};

export const parseParamSfo = (data: Buffer): string | null =>
  parseParamSfoValue(data, "TITLE_ID");
