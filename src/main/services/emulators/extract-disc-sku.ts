import { promises as fs } from "node:fs";
import path from "node:path";

import type { EmulatorSystem } from "@types";
import { logger } from "@main/services/logger";
import { resolveSniffTarget } from "./sniff-disc-platform";

const BOOT_SKU_RE =
  /BOOT2?\s*=\s*cdrom0?:\\?([A-Z]{4}[_\-.\s]?\d{3}[_\-.\s]?\d{2})/i;
// ISO9660 directory entry holding the PS1/PS2 executable filename, e.g.
// `SLUS_213.76;1`. Anchored on `;1` to avoid arbitrary 4-letter false positives.
const ISO_FILENAME_SKU_RE = /([A-Z]{4})_(\d{3})\.(\d{2});1/;
const CHUNK_SIZE = 1024 * 1024;
const SCAN_LIMIT = 64 * 1024 * 1024;
const TAIL_BYTES = 128;

const normalize = (raw: string): string => {
  const stripped = raw.toUpperCase().replace(/[^A-Z0-9]/g, "");
  const match = stripped.match(/^([A-Z]{4})(\d+)$/);
  if (!match) return stripped;
  return `${match[1]}-${match[2]}`;
};

const extractPs12Sku = async (filePath: string): Promise<string | null> => {
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

      const match = text.match(BOOT_SKU_RE);
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
        const fileMatch = text.match(ISO_FILENAME_SKU_RE);
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

const parseParamSfo = (data: Buffer): string | null => {
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

const extractPs3TitleId = async (
  primaryPath: string
): Promise<string | null> => {
  try {
    const stat = await fs.stat(primaryPath).catch(() => null);
    if (!stat) return null;

    if (stat.isDirectory()) {
      const sfoPath = path.join(primaryPath, "PARAM.SFO");
      const data = await fs.readFile(sfoPath).catch(() => null);
      if (!data) return null;
      return parseParamSfo(data);
    }

    const folderName = path.basename(path.dirname(primaryPath));
    const titleIdGuess = folderName.match(/[A-Z]{4}\d{5}/);
    if (titleIdGuess) return normalize(titleIdGuess[0]);

    const fileName = path.basename(primaryPath);
    const fileTitleId = fileName.match(/[A-Z]{4}\d{5}/);
    if (fileTitleId) return normalize(fileTitleId[0]);

    return null;
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
