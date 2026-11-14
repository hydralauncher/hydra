import fs from "node:fs";

import { parseParamSfoValue } from "../emulators/param-sfo.js";

const PKG_MAGIC = 0x7f434e54;
const HEADER_SIZE = 0x1000;
const ENTRY_SIZE = 32;
const ENTRY_NAMES_ID = 0x200;
const PARAM_SFO_ID = 0x1000;
const FIRST_NAMED_ENTRY_ID = 0x1000;
const DELTA_PATCH_FLAG = 0x41000000;

const FIXED_ENTRY_NAMES: Record<number, string> = {
  0x400: "license.dat",
  0x401: "license.info",
  0x402: "nptitle.dat",
  0x403: "npbind.dat",
  0x404: "selfinfo.dat",
  0x406: "imageinfo.dat",
  0x407: "target-deltainfo.dat",
  0x408: "origin-deltainfo.dat",
  0x409: "psreserved.dat",
};

export type Ps4PkgErrorCode =
  | "not_ps4_pkg"
  | "unsupported_pkg"
  | "no_space"
  | "missing_base_game"
  | "other_game"
  | "not_newer"
  | "keys_unavailable"
  | "bad_keys"
  | "cancelled"
  | "failed";

export type Ps4PkgKind = "game" | "patch" | "addon" | "other";

export interface Ps4PkgEntry {
  id: number;
  name: string | null;
  isEncrypted: boolean;
  keyIndex: number;
  offset: number;
  size: number;
  raw: Buffer;
}

export interface Ps4PkgInfo {
  contentId: string;
  titleId: string;
  kind: Ps4PkgKind;
  isDeltaPatch: boolean;
  appVersion: string | null;
  pfsImageOffset: number;
  pfsImageSize: number;
  entries: Ps4PkgEntry[];
}

export class Ps4PkgError extends Error {
  constructor(
    readonly code: Ps4PkgErrorCode,
    message: string
  ) {
    super(message);
  }
}

/** Reads a range of the PKG, refusing ranges past its end before allocating. */
export const readExactly = (fd: number, position: number, length: number) => {
  if (
    !Number.isSafeInteger(position) ||
    !Number.isSafeInteger(length) ||
    position < 0 ||
    length < 0 ||
    position + length > fs.fstatSync(fd).size
  ) {
    throw new Ps4PkgError("unsupported_pkg", "PKG range is out of the file");
  }
  const buffer = Buffer.alloc(length);
  let read = 0;
  while (read < length) {
    const count = fs.readSync(fd, buffer, read, length - read, position + read);
    if (count === 0) throw new Error("Unexpected end of PKG file");
    read += count;
  }
  return buffer;
};

const readCString = (buffer: Buffer, offset: number) => {
  if (offset >= buffer.length) return null;
  const end = buffer.indexOf(0, offset);
  const name = buffer.toString("utf8", offset, end === -1 ? undefined : end);
  return name || null;
};

const kindFromCategory = (category: string | null): Ps4PkgKind => {
  const value = category?.replace(/[^a-z]/gi, "").toLowerCase() ?? "";
  if (value.startsWith("gd")) return "game";
  if (value.startsWith("gp")) return "patch";
  if (value.startsWith("ac")) return "addon";
  return "other";
};

// Real PKGs have a few dozen entries; a header claiming more is malformed.
const MAX_PKG_ENTRIES = 4096;

const readEntries = (fd: number, header: Buffer): Ps4PkgEntry[] => {
  const count = header.readUInt32BE(0x10);
  const tableOffset = header.readUInt32BE(0x18);
  if (count > MAX_PKG_ENTRIES) {
    throw new Ps4PkgError("unsupported_pkg", "PKG has too many entries");
  }
  const table = readExactly(fd, tableOffset, count * ENTRY_SIZE);

  const entries = Array.from({ length: count }, (_, index) => {
    const raw = table.subarray(index * ENTRY_SIZE, (index + 1) * ENTRY_SIZE);
    return {
      id: raw.readUInt32BE(0),
      nameOffset: raw.readUInt32BE(4),
      isEncrypted: (raw.readUInt32BE(8) & 0x80000000) !== 0,
      keyIndex: (raw.readUInt32BE(12) & 0xf000) >> 12,
      offset: raw.readUInt32BE(16),
      size: raw.readUInt32BE(20),
      raw: Buffer.from(raw),
    };
  });

  const namesEntry = entries.find((entry) => entry.id === ENTRY_NAMES_ID);
  const names = namesEntry
    ? readExactly(fd, namesEntry.offset, namesEntry.size)
    : Buffer.alloc(0);

  return entries.map(({ nameOffset, ...entry }) => ({
    ...entry,
    name:
      entry.id >= FIRST_NAMED_ENTRY_ID
        ? readCString(names, nameOffset)
        : (FIXED_ENTRY_NAMES[entry.id] ?? null),
  }));
};

export const readPs4PkgInfoFromFd = (fd: number): Ps4PkgInfo => {
  const header = readExactly(fd, 0, HEADER_SIZE);
  if (header.readUInt32BE(0) !== PKG_MAGIC) {
    throw new Ps4PkgError("not_ps4_pkg", "Not a PS4 PKG");
  }

  const contentId = header.toString("latin1", 0x40, 0x64).replace(/\0.*$/, "");
  const titleId = contentId.slice(7, 16);
  if (!/^[A-Z]{4}\d{5}$/.test(titleId)) {
    throw new Ps4PkgError("not_ps4_pkg", `Unexpected content id ${contentId}`);
  }

  const entries = readEntries(fd, header);
  const paramSfoEntry = entries.find((entry) => entry.id === PARAM_SFO_ID);
  const paramSfo = paramSfoEntry
    ? readExactly(fd, paramSfoEntry.offset, paramSfoEntry.size)
    : null;

  return {
    contentId,
    titleId,
    kind: kindFromCategory(
      paramSfo ? parseParamSfoValue(paramSfo, "CATEGORY") : null
    ),
    isDeltaPatch:
      (header.readUInt32BE(0x78) & DELTA_PATCH_FLAG) === DELTA_PATCH_FLAG,
    appVersion: paramSfo ? parseParamSfoValue(paramSfo, "APP_VER") : null,
    pfsImageOffset: Number(header.readBigUInt64BE(0x410)),
    pfsImageSize: Number(header.readBigUInt64BE(0x418)),
    entries,
  };
};

export const readPs4PkgInfo = async (pkgPath: string): Promise<Ps4PkgInfo> => {
  const fd = fs.openSync(pkgPath, "r");
  try {
    return readPs4PkgInfoFromFd(fd);
  } finally {
    fs.closeSync(fd);
  }
};
