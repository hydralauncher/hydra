import { promises as fs } from "node:fs";

import { parseParamSfo } from "./param-sfo.js";

const ISO_SECTOR = 2048;
const ISO_DIR_READ_CAP = 256 * 1024;
const ISO_SFO_READ_CAP = 1024 * 1024;

interface IsoDirEntry {
  name: string;
  lba: number;
  size: number;
  isDir: boolean;
}

const parseIsoDirRecords = (buf: Buffer): IsoDirEntry[] => {
  const entries: IsoDirEntry[] = [];
  let pos = 0;
  while (pos < buf.length) {
    const recLen = buf[pos];
    if (recLen === 0) {
      const next = (Math.floor(pos / ISO_SECTOR) + 1) * ISO_SECTOR;
      if (next <= pos) break;
      pos = next;
      continue;
    }
    if (pos + recLen > buf.length || pos + 33 > buf.length) break;
    const lba = buf.readUInt32LE(pos + 2);
    const size = buf.readUInt32LE(pos + 10);
    const flags = buf[pos + 25];
    const nameLen = buf[pos + 32];
    const nameRaw = buf.subarray(pos + 33, pos + 33 + nameLen);
    let name: string;
    if (nameLen === 1 && (nameRaw[0] === 0 || nameRaw[0] === 1)) {
      name = nameRaw[0] === 0 ? "." : "..";
    } else {
      name = nameRaw.toString("latin1").split(";")[0];
    }
    entries.push({ name, lba, size, isDir: (flags & 0x02) !== 0 });
    pos += recLen;
  }
  return entries;
};

const readIsoExtent = async (
  fh: import("node:fs/promises").FileHandle,
  lba: number,
  byteLength: number,
  cap: number
): Promise<Buffer> => {
  const len = Math.min(byteLength, cap);
  const buf = Buffer.alloc(len);
  await fh.read(buf, 0, len, lba * ISO_SECTOR);
  return buf;
};

const findIsoEntry = (
  entries: IsoDirEntry[],
  name: string
): IsoDirEntry | null =>
  entries.find(
    (e) =>
      e.name !== "." &&
      e.name !== ".." &&
      e.name.toUpperCase() === name.toUpperCase()
  ) ?? null;

export const extractTitleIdFromIso = async (
  isoPath: string
): Promise<string | null> => {
  let fh: import("node:fs/promises").FileHandle | null = null;
  try {
    fh = await fs.open(isoPath, "r");
    const pvd = Buffer.alloc(ISO_SECTOR);
    const { bytesRead } = await fh.read(pvd, 0, ISO_SECTOR, 16 * ISO_SECTOR);
    if (bytesRead < 190 || pvd[0] !== 0x01) return null;
    if (pvd.subarray(1, 6).toString("latin1") !== "CD001") return null;

    const rootLba = pvd.readUInt32LE(156 + 2);
    const rootSize = pvd.readUInt32LE(156 + 10);
    const rootBuf = await readIsoExtent(
      fh,
      rootLba,
      rootSize,
      ISO_DIR_READ_CAP
    );
    const ps3Game = findIsoEntry(parseIsoDirRecords(rootBuf), "PS3_GAME");
    if (!ps3Game?.isDir) return null;

    const ps3Buf = await readIsoExtent(
      fh,
      ps3Game.lba,
      ps3Game.size,
      ISO_DIR_READ_CAP
    );
    const paramSfo = findIsoEntry(parseIsoDirRecords(ps3Buf), "PARAM.SFO");
    if (!paramSfo || paramSfo.isDir) return null;

    const sfoBuf = await readIsoExtent(
      fh,
      paramSfo.lba,
      paramSfo.size,
      ISO_SFO_READ_CAP
    );
    return parseParamSfo(sfoBuf);
  } catch {
    return null;
  } finally {
    await fh?.close();
  }
};
