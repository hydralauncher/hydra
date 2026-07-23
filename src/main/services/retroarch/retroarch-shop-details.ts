import { chunk } from "lodash-es";

import type { RetroArchPlatform } from "@types";

import { HydraApi } from "../hydra-api";
import { logger } from "../logger";
import type { LaunchboxShopDetailsEntry } from "../emulators/launchbox-shop-details";

const ROM_MATCH_CHUNK_SIZE = 100;

export interface RomMatchRequestEntry {
  crc32: string;
  fileName: string;
  sizeBytes: number;
  serial: string | null;
}

interface RomMatchResponseEntry extends LaunchboxShopDetailsEntry {
  matchedCrc32s?: string[];
}

const normalizeCrc = (raw: string): string => raw.trim().toUpperCase();

export const fetchShopDetailsForHashes = async (
  platform: RetroArchPlatform,
  roms: RomMatchRequestEntry[]
): Promise<Map<string, LaunchboxShopDetailsEntry>> => {
  const lookup = new Map<string, LaunchboxShopDetailsEntry>();
  if (roms.length === 0) return lookup;

  const chunks = chunk(roms, ROM_MATCH_CHUNK_SIZE);
  for (const romChunk of chunks) {
    try {
      const response = await HydraApi.post<RomMatchResponseEntry[]>(
        "/games/rom-match",
        { shop: "launchbox", platform, roms: romChunk },
        { needsAuth: false }
      );
      if (!Array.isArray(response)) continue;

      for (const entry of response) {
        if (!entry?.objectId || !entry.data) continue;
        const matchedHashes =
          entry.matchedCrc32s ?? entry.matchedSkus ?? entry.skus ?? [];
        for (const hash of matchedHashes) {
          lookup.set(normalizeCrc(hash), entry);
        }
      }
    } catch (err) {
      logger.error("Failed to fetch rom-match batch", err);
    }
  }

  return lookup;
};
