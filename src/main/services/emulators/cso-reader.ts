import { promises as fs } from "node:fs";

import { logger } from "@main/services/logger";
import {
  HEADER_BYTES,
  csoBlockRange,
  inflateCsoBlock,
  parseCsoHeader,
} from "./cso-decode";

const CSO_SCAN_LIMIT = 16 * 1024 * 1024;
const MAX_BLOCKS_SCANNED = 24000;

export interface CsoScanResult {
  chunks: Buffer[];
}

const readAt = async (
  fh: fs.FileHandle,
  pos: number,
  len: number
): Promise<Buffer> => {
  const buf = Buffer.allocUnsafe(len);
  const { bytesRead } = await fh.read(buf, 0, len, pos);
  return bytesRead === len ? buf : buf.subarray(0, bytesRead);
};

export const readCsoLeadingData = async (
  filePath: string
): Promise<CsoScanResult | null> => {
  let fh: fs.FileHandle | null = null;
  try {
    fh = await fs.open(filePath, "r");
    const headerRaw = await readAt(fh, 0, HEADER_BYTES);
    const header = parseCsoHeader(headerRaw);
    if (!header) {
      logger.log("[cso] unsupported header", {
        filePath,
        magic: headerRaw.toString("latin1", 0, 4),
      });
      return null;
    }

    if (header.version > 1) {
      logger.log("[cso] unsupported version", {
        filePath,
        version: header.version,
      });
      return null;
    }

    const maxBlocks = Math.min(header.numBlocks, MAX_BLOCKS_SCANNED);
    const indexBytes = (maxBlocks + 1) * 4;
    const indexRaw = await readAt(fh, HEADER_BYTES, indexBytes);
    if (indexRaw.length < indexBytes) {
      logger.log("[cso] truncated index", {
        filePath,
        expected: indexBytes,
        got: indexRaw.length,
      });
      return null;
    }

    const chunks: Buffer[] = [];
    let decoded = 0;
    let skipped = 0;

    for (let b = 0; b < maxBlocks && decoded < CSO_SCAN_LIMIT; b++) {
      const { start, length, plain } = csoBlockRange(indexRaw, header, b);
      if (length <= 0) {
        skipped += 1;
        continue;
      }

      const raw = await readAt(fh, start, length);
      const chunk = plain
        ? raw.subarray(0, header.blockSize)
        : inflateCsoBlock(raw);

      if (!chunk || chunk.length === 0) {
        skipped += 1;
        continue;
      }

      chunks.push(chunk);
      decoded += chunk.length;
    }

    logger.log("[cso] leading-data scan", {
      filePath,
      version: header.version,
      blockSize: header.blockSize,
      numBlocks: header.numBlocks,
      blocksDecoded: chunks.length,
      blocksSkipped: skipped,
      bytesDecoded: decoded,
    });

    return chunks.length > 0 ? { chunks } : null;
  } catch {
    return null;
  } finally {
    await fh?.close();
  }
};
