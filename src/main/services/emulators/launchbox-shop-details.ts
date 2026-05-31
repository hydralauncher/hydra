import { chunk } from "lodash-es";

import { HydraApi } from "@main/services/hydra-api";
import { logger } from "@main/services/logger";

/*
 * Shared LaunchBox shop-details lookup. Resolves a list of game SKUs into shop
 * metadata (title + cover art) via the same endpoint the emulator ROM-import
 * flow uses. Extracted here so both ROM import and PS2 memory-card scanning can
 * reuse it. Direct (non-barrel) service imports avoid a services/emulators cycle.
 */

export interface LaunchboxShopDetailsAssetsResponse {
  objectId: string;
  shop: "launchbox";
  title: string;
  iconUrl: string | null;
  libraryHeroImageUrl: string | null;
  libraryImageUrl: string | null;
  logoImageUrl: string | null;
}

export interface LaunchboxShopDetailsEntry {
  objectId: string;
  shop: "launchbox";
  platform?: string | null;
  skus?: string[];
  matchedSkus?: string[];
  data: {
    title: string;
    platform?: string | null;
    description?: string | null;
    releaseDate?: string | null;
    developers?: string[];
    publishers?: string[];
    genres?: string[];
    headerImage?: string | null;
    website?: string | null;
    screenshots?: string[];
    assets?: LaunchboxShopDetailsAssetsResponse | null;
  } | null;
}

const SHOP_DETAILS_CHUNK_SIZE = 100;

export const normalizeSku = (raw: string): string =>
  raw.toUpperCase().replace(/[^A-Z0-9]/g, "");

/**
 * Resolve SKUs to shop-details entries, keyed by `normalizeSku(matchedSku)`.
 * Requests are chunked; failures per chunk are logged and skipped.
 */
export const fetchShopDetailsForSkus = async (
  skus: string[]
): Promise<Map<string, LaunchboxShopDetailsEntry>> => {
  const lookup = new Map<string, LaunchboxShopDetailsEntry>();
  if (skus.length === 0) return lookup;

  const chunks = chunk(skus, SHOP_DETAILS_CHUNK_SIZE);
  for (const skuChunk of chunks) {
    try {
      const response = await HydraApi.post<LaunchboxShopDetailsEntry[]>(
        "/games/shop-details",
        { shop: "launchbox", skus: skuChunk },
        { needsAuth: false }
      );
      if (!Array.isArray(response)) continue;

      for (const entry of response) {
        if (!entry?.objectId || !entry.data) continue;
        const entrySkus = entry.skus ?? entry.matchedSkus ?? [];
        for (const matchedSku of entrySkus) {
          lookup.set(normalizeSku(matchedSku), entry);
        }
      }
    } catch (err) {
      logger.error("Failed to fetch launchbox shop-details batch", err);
    }
  }
  return lookup;
};

/** Project a shop-details entry down to just the asset URLs callers display. */
export const mapEntryToAssets = (
  entry: LaunchboxShopDetailsEntry
): LaunchboxShopDetailsAssetsResponse => ({
  objectId: entry.objectId,
  shop: "launchbox",
  title: entry.data?.assets?.title ?? entry.data?.title ?? "",
  iconUrl: entry.data?.assets?.iconUrl ?? null,
  libraryImageUrl: entry.data?.assets?.libraryImageUrl ?? null,
  libraryHeroImageUrl: entry.data?.assets?.libraryHeroImageUrl ?? null,
  logoImageUrl: entry.data?.assets?.logoImageUrl ?? null,
});
