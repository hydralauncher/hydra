import { promises as fs } from "node:fs";
import path from "node:path";

import type { EmulatorSystem } from "@types";
import { logger } from "@main/services/logger";
import { resolveSniffTarget } from "./sniff-disc-platform";
import { readChdLeadingData } from "./chd-reader";
import { readCsoLeadingData } from "./cso-reader";
import { normalize } from "./sku-normalize";
import {
  BOOT_SKU_RE,
  ISO_FILENAME_SKU_RE,
  TAIL_BYTES,
  scanBuffersForRawSku,
} from "./sku-scan";

const scanBuffersForSku = (chunks: Buffer[]): string | null => {
  const raw = scanBuffersForRawSku(chunks);
  return raw ? normalize(raw) : null;
};

const CHUNK_SIZE = 1024 * 1024;
const SCAN_LIMIT = 64 * 1024 * 1024;

export { normalize };

const extractChdSku = async (filePath: string): Promise<string | null> => {
  const data = await readChdLeadingData(filePath);
  if (!data) {
    logger.log("[extract-sku] chd not decodable", { filePath });
    return null;
  }
  const sku = scanBuffersForSku(data.chunks);
  logger.log("[extract-sku] chd scan", {
    filePath,
    chunks: data.chunks.length,
    sku,
  });
  return sku;
};

const extractCsoSku = async (filePath: string): Promise<string | null> => {
  const data = await readCsoLeadingData(filePath);
  if (!data) {
    logger.log("[extract-sku] cso not decodable", { filePath });
    return null;
  }
  const sku = scanBuffersForSku(data.chunks);
  logger.log("[extract-sku] cso scan", {
    filePath,
    chunks: data.chunks.length,
    sku,
  });
  return sku;
};

const extractPs12Sku = async (filePath: string): Promise<string | null> => {
  const lower = filePath.toLowerCase();
  if (lower.endsWith(".chd")) {
    return extractChdSku(filePath);
  }
  if (lower.endsWith(".cso")) {
    return extractCsoSku(filePath);
  }

  const target = await resolveSniffTarget(filePath);
  logger.log("[extract-sku] start", { filePath, target });
  if (!target) {
    logger.log("[extract-sku] no sniff target (unsupported format)", {
      filePath,
    });
    return null;
  }

  let fh: import("node:fs/promises").FileHandle | null = null;
  try {
    fh = await fs.open(target, "r");
    const stat = await fh.stat();
    logger.log("[extract-sku] opened", {
      target,
      sizeBytes: stat.size,
      scanLimitBytes: SCAN_LIMIT,
    });

    const buf = Buffer.alloc(CHUNK_SIZE);
    let offset = 0;
    let tail = "";
    let isoFallback: { sku: string; offset: number } | null = null;

    while (offset < SCAN_LIMIT) {
      const { bytesRead } = await fh.read(buf, 0, CHUNK_SIZE, offset);
      if (bytesRead === 0) break;

      const text = tail + buf.subarray(0, bytesRead).toString("latin1");

      const match = BOOT_SKU_RE.exec(text);
      if (match) {
        const sku = normalize(match[1]);
        logger.log("[extract-sku] matched (BOOT)", {
          target,
          rawMatch: match[0],
          captured: match[1],
          normalized: sku,
          offset,
        });
        return sku;
      }

      if (isoFallback === null) {
        const fileMatch = ISO_FILENAME_SKU_RE.exec(text);
        if (fileMatch) {
          const captured = `${fileMatch[1]}_${fileMatch[2]}.${fileMatch[3]}`;
          isoFallback = {
            sku: normalize(captured),
            offset: offset + (fileMatch.index ?? 0) - tail.length,
          };
        }
      }

      tail = text.slice(-TAIL_BYTES);
      offset += bytesRead;
    }

    if (isoFallback) {
      logger.log("[extract-sku] matched (ISO filename fallback)", {
        target,
        sku: isoFallback.sku,
        offset: isoFallback.offset,
      });
      return isoFallback.sku;
    }

    logger.log("[extract-sku] no match in scan window", {
      target,
      scannedBytes: offset,
    });
    return null;
  } catch (err) {
    logger.log("[extract-sku] error", { target, error: String(err) });
    return null;
  } finally {
    await fh?.close();
  }
};

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

export const parseParamSfo = (data: Buffer): string | null => {
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
    if (key === "TITLE_ID") {
      const valueStart = dataTableStart + dataOffset;
      const valueEnd = valueStart + dataUsedSize;
      if (valueEnd > data.length) return null;
      const raw = data
        .subarray(valueStart, valueEnd)
        .toString("ascii")
        .replace(/\0+$/, "")
        .trim();
      return raw.length > 0 ? normalize(raw) : null;
    }
  }
  return null;
};

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
    if (bytesRead < 190) return null;
    if (pvd[0] !== 0x01) return null;
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

const PKG_MAGIC = 0x7f504b47;

export const extractTitleIdFromPkg = async (
  pkgPath: string
): Promise<string | null> => {
  let fh: import("node:fs/promises").FileHandle | null = null;
  try {
    fh = await fs.open(pkgPath, "r");
    const head = Buffer.alloc(0x80);
    const { bytesRead } = await fh.read(head, 0, 0x80, 0);
    if (bytesRead < 0x54) {
      logger.log("[extract-sku] pkg too short", { pkgPath, bytesRead });
      return null;
    }
    const magic = head.readUInt32BE(0);
    if (magic !== PKG_MAGIC) {
      logger.log("[extract-sku] pkg bad magic", {
        pkgPath,
        magic: magic.toString(16),
      });
      return null;
    }

    const contentId = head.subarray(0x30, 0x30 + 36).toString("latin1");
    logger.log("[extract-sku] pkg contentId", { pkgPath, contentId });
    const m = contentId.match(/[A-Z]{4}\d{5}/);
    if (m) return normalize(m[0]);

    const wider = head.subarray(0, bytesRead).toString("latin1");
    const w = wider.match(/[A-Z]{4}\d{5}/);
    if (w) {
      logger.log("[extract-sku] pkg wider match", {
        pkgPath,
        captured: w[0],
      });
      return normalize(w[0]);
    }
    logger.log("[extract-sku] pkg no titleid", { pkgPath });
    return null;
  } catch (err) {
    logger.log("[extract-sku] pkg error", { pkgPath, error: String(err) });
    return null;
  } finally {
    await fh?.close();
  }
};

const TITLE_ID_GUESS_RE = /[A-Z]{4}\d{5}/;

const titleIdFromPs3Directory = async (
  dirPath: string
): Promise<string | null> => {
  const sfoCandidates = [
    path.join(dirPath, "PARAM.SFO"),
    path.join(dirPath, "PS3_GAME", "PARAM.SFO"),
  ];
  for (const sfoPath of sfoCandidates) {
    const data = await fs.readFile(sfoPath).catch(() => null);
    if (data) {
      const id = parseParamSfo(data);
      if (id) return id;
    }
  }
  const folderGuess = TITLE_ID_GUESS_RE.exec(path.basename(dirPath));
  return folderGuess ? normalize(folderGuess[0]) : null;
};

const titleIdFromPs3File = async (filePath: string): Promise<string | null> => {
  const lower = filePath.toLowerCase();
  if (lower.endsWith(".iso")) {
    const fromIso = await extractTitleIdFromIso(filePath);
    if (fromIso) return fromIso;
  }
  if (lower.endsWith(".pkg")) {
    const fromPkg = await extractTitleIdFromPkg(filePath);
    if (fromPkg) return fromPkg;
  }

  const fileGuess = TITLE_ID_GUESS_RE.exec(path.basename(filePath));
  if (fileGuess) return normalize(fileGuess[0]);
  const folderGuess = TITLE_ID_GUESS_RE.exec(
    path.basename(path.dirname(filePath))
  );
  if (folderGuess) return normalize(folderGuess[0]);

  return null;
};

const extractPs3TitleId = async (
  primaryPath: string
): Promise<string | null> => {
  try {
    const stat = await fs.stat(primaryPath).catch(() => null);
    if (!stat) return null;
    if (stat.isDirectory()) return titleIdFromPs3Directory(primaryPath);
    return titleIdFromPs3File(primaryPath);
  } catch {
    return null;
  }
};

export const extractDiscSku = async (
  primaryPath: string,
  system: EmulatorSystem
): Promise<string | null> => {
  if (system === "ps3") return extractPs3TitleId(primaryPath);
  return extractPs12Sku(primaryPath);
};
