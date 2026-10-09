import { promises as fs } from "node:fs";
import path from "node:path";

import type { EmulatorSystem } from "@types";
import { logger } from "@main/services/logger";
import { resolveSniffTarget } from "./sniff-disc-platform";
import { readChdLeadingData } from "./chd-reader";
import { readCsoLeadingData } from "./cso-reader";
import { extractDolphinGameId } from "./dolphin-disc-reader";
import { normalize } from "./sku-normalize";
import { parseParamSfo, parseParamSfoValue } from "./param-sfo";
import { readVerifiedPs3DirectoryTitleId } from "./verified-ps3-directory-title-id";
import { readVerifiedPs3PkgTitleId } from "./verified-ps3-pkg-title-id";
import { extractTitleIdFromIso } from "./verified-ps3-iso-title-id";

export { extractTitleIdFromIso };
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
export { parseParamSfo, parseParamSfoValue };

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

const scanTargetForSku = async (target: string): Promise<string | null> => {
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

  const targetExists = await fs
    .access(target)
    .then(() => true)
    .catch(() => false);
  if (!targetExists) {
    logger.warn("[extract-sku] sniff target missing on disk", {
      filePath,
      target,
    });
    return null;
  }

  return scanTargetForSku(target);
};

const ISO_SFO_READ_CAP = 1024 * 1024;

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

/** Cloud Save must use metadata from the media, never a filename guess. */
export const extractVerifiedPs3TitleId = async (
  primaryPath: string
): Promise<string | null> => {
  const stat = await fs.stat(primaryPath).catch(() => null);
  if (!stat) return null;

  if (stat.isDirectory())
    return readVerifiedPs3DirectoryTitleId(primaryPath, true);

  if (!stat.isFile()) return null;
  const extension = path.extname(primaryPath).toLowerCase();
  if (extension === ".iso") return extractTitleIdFromIso(primaryPath);
  if (extension === ".pkg") return readVerifiedPs3PkgTitleId(primaryPath);
  return readVerifiedPs3DirectoryTitleId(primaryPath, false);
};

const PSP_DISC_ID_RE = /[A-Z]{4}[-_ ]?\d{5}/;
const PSP_SCAN_TAIL_LENGTH = 16;
const PSP_RAW_SCAN_LIMIT = 16 * 1024 * 1024;
const PBP_HEADER_SIZE = 0x28;
const PBP_MAGIC = Buffer.from([0, 0x50, 0x42, 0x50]);
const PBP_PARAM_SFO_OFFSET_FIELD = 0x08;
const PBP_ICON0_OFFSET_FIELD = 0x0c;

const scanChunksForPspDiscId = (chunks: Buffer[]): string | null => {
  let tail = "";
  for (const chunk of chunks) {
    const text = tail + chunk.toString("latin1");
    const match = PSP_DISC_ID_RE.exec(text);
    if (match) return normalize(match[0]);
    tail = text.slice(-PSP_SCAN_TAIL_LENGTH);
  }
  return null;
};

const extractPspDirectoryDiscId = async (primaryPath: string) => {
  const candidates = [
    path.join(primaryPath, "PSP_GAME", "PARAM.SFO"),
    path.join(primaryPath, "PARAM.SFO"),
  ];
  for (const candidate of candidates) {
    const data = await fs.readFile(candidate).catch(() => null);
    const id = data ? parseParamSfoValue(data, "DISC_ID") : null;
    if (id) return id;
  }
  return null;
};

const extractPbpDiscId = async (primaryPath: string, fileSize: number) => {
  const file = await fs.open(primaryPath, "r").catch(() => null);
  if (!file) return null;

  try {
    const header = Buffer.alloc(PBP_HEADER_SIZE);
    const { bytesRead } = await file.read(header, 0, header.length, 0);
    if (
      bytesRead !== header.length ||
      !header.subarray(0, 4).equals(PBP_MAGIC)
    ) {
      return null;
    }

    const start = header.readUInt32LE(PBP_PARAM_SFO_OFFSET_FIELD);
    const end = Math.min(
      header.readUInt32LE(PBP_ICON0_OFFSET_FIELD),
      start + ISO_SFO_READ_CAP
    );
    if (start >= end || end > fileSize) return null;

    const data = Buffer.alloc(end - start);
    await file.read(data, 0, data.length, start);
    return parseParamSfoValue(data, "DISC_ID");
  } finally {
    await file.close();
  }
};

const extractCompressedPspDiscId = async (
  primaryPath: string,
  extension: string
) => {
  const data =
    extension === ".cso"
      ? await readCsoLeadingData(primaryPath)
      : await readChdLeadingData(primaryPath);
  return data ? scanChunksForPspDiscId(data.chunks) : null;
};

const extractRawPspDiscId = async (primaryPath: string, fileSize: number) => {
  const file = await fs.open(primaryPath, "r").catch(() => null);
  if (!file) return null;

  try {
    const data = Buffer.alloc(Math.min(fileSize, PSP_RAW_SCAN_LIMIT));
    const { bytesRead } = await file.read(data, 0, data.length, 0);
    const match = PSP_DISC_ID_RE.exec(
      data.subarray(0, bytesRead).toString("latin1")
    );
    return match ? normalize(match[0]) : null;
  } finally {
    await file.close();
  }
};

const extractPspDiscId = async (primaryPath: string) => {
  const stat = await fs.stat(primaryPath).catch(() => null);
  if (!stat) return null;
  if (stat.isDirectory()) return extractPspDirectoryDiscId(primaryPath);

  const extension = path.extname(primaryPath).toLowerCase();
  let id: string | null = null;
  if (extension === ".pbp") {
    id = await extractPbpDiscId(primaryPath, stat.size);
  } else if (extension === ".cso" || extension === ".chd") {
    id = await extractCompressedPspDiscId(primaryPath, extension);
  } else {
    id = await extractRawPspDiscId(primaryPath, stat.size);
  }
  if (id) return id;

  const fallback = PSP_DISC_ID_RE.exec(path.basename(primaryPath));
  return fallback ? normalize(fallback[0]) : null;
};

export const extractDiscSku = async (
  primaryPath: string,
  system: EmulatorSystem
): Promise<string | null> => {
  switch (system) {
    case "ps1":
    case "ps2":
      return extractPs12Sku(primaryPath);
    case "ps3":
      return extractPs3TitleId(primaryPath);
    case "psp":
      return extractPspDiscId(primaryPath);
    case "dolphin":
      return extractDolphinGameId(primaryPath);
  }
};
