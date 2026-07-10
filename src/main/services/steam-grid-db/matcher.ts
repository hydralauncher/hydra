import type {
  Game,
  GameShop,
  SgdbAsset,
  SgdbAssetType,
  SgdbSelectedAsset,
  SgdbSelectionRecord,
  SgdbSettings,
  SgdbShopAssetMatrix,
  SgdbVariantsCache,
} from "@types";
import {
  gamesSgdbSelectionSublevel,
  gamesSgdbVariantsCacheSublevel,
  gamesSublevel,
  levelKeys,
} from "@main/level";
import {
  removeReleaseYearFromName,
  removeSpecialEditionFromName,
} from "@shared";
import { SteamGridDbClient } from "./client";
import { downloadImageToCache } from "./download-image";
import { getUserPreferencesRecord } from "./config";
import { WindowManager } from "../window-manager";
import { logger } from "../logger";

const ALL_TYPES: SgdbAssetType[] = ["grid", "hero", "logo", "icon"];
const FALLBACK_TYPES: SgdbAssetType[] = ["hero", "grid"];
const CACHE_TTL = 1000 * 60 * 60 * 24 * 7; // 7 days
const THROTTLE_MS = 120;
const POOL_SIZE = 3;

const PLURAL: Record<SgdbAssetType, "grids" | "heroes" | "logos" | "icons"> = {
  grid: "grids",
  hero: "heroes",
  logo: "logos",
  icon: "icons",
};

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

const getMatrix = (
  settings: SgdbSettings,
  shop: GameShop
): SgdbShopAssetMatrix | null => {
  if (shop === "steam") return settings.matrix.steam;
  if (shop === "launchbox") return settings.matrix.launchbox;
  return null;
};

const enabledTypesFor = (matrix: SgdbShopAssetMatrix) =>
  ALL_TYPES.filter((type) => matrix[type]);

const bestOf = (
  cache: SgdbVariantsCache,
  type: SgdbAssetType
): SgdbAsset | null => cache[PLURAL[type]]?.[0] ?? null;

const normalizeTitle = (title: string) =>
  removeReleaseYearFromName(removeSpecialEditionFromName(title))
    .replace(/[™®©]/g, "")
    .trim();

const getGame = (gameKey: string): Promise<Game | undefined> =>
  gamesSublevel.get(gameKey);

const getSelection = (
  gameKey: string
): Promise<SgdbSelectionRecord | undefined> =>
  gamesSgdbSelectionSublevel.get(gameKey);

const getCache = (gameKey: string): Promise<SgdbVariantsCache | undefined> =>
  gamesSgdbVariantsCacheSublevel.get(gameKey);

const resolveGameId = async (
  shop: GameShop,
  objectId: string,
  title: string
): Promise<number | null> => {
  if (shop === "steam") {
    return SteamGridDbClient.getGameBySteamAppId(objectId);
  }
  return SteamGridDbClient.searchGameId(normalizeTitle(title));
};

const emptyCache = (sgdbGameId: number | null): SgdbVariantsCache => ({
  sgdbGameId,
  grids: [],
  heroes: [],
  logos: [],
  icons: [],
  fetched: [],
  updatedAt: Date.now(),
});

const ensureVariants = async (
  gameKey: string,
  shop: GameShop,
  objectId: string,
  title: string,
  requestedTypes: SgdbAssetType[],
  forceFresh: boolean
): Promise<SgdbVariantsCache | null> => {
  const now = Date.now();
  const existing = await getCache(gameKey);
  const stale = !existing || forceFresh || existing.updatedAt + CACHE_TTL < now;

  const base: SgdbVariantsCache = stale
    ? emptyCache(await resolveGameId(shop, objectId, title))
    : existing!;

  if (base.sgdbGameId == null) {
    // Only persist (and reset the TTL) when we just tried to resolve. On a cached
    // miss, leave updatedAt untouched so the 7-day window can elapse and retry.
    if (stale) {
      base.updatedAt = now;
      await gamesSgdbVariantsCacheSublevel.put(gameKey, base);
    }
    return base;
  }

  const toFetch = requestedTypes.filter(
    (type) => stale || !base.fetched.includes(type)
  );

  if (toFetch.length) {
    for (const type of toFetch) {
      base[PLURAL[type]] = await SteamGridDbClient.getAssets(
        type,
        base.sgdbGameId
      );
      if (!base.fetched.includes(type)) base.fetched.push(type);
      await sleep(THROTTLE_MS);
    }
    base.updatedAt = now;
    await gamesSgdbVariantsCacheSublevel.put(gameKey, base);
  }

  return base;
};

interface MatchGameOptions {
  forceFresh?: boolean;
  silent?: boolean;
}

interface ResolvedMatchTypes {
  types: SgdbAssetType[];
  enabledTypes: Set<SgdbAssetType>;
}

const resolveMatchTypes = (
  override: SgdbSelectionRecord["override"],
  settings: SgdbSettings | undefined,
  shop: GameShop
): ResolvedMatchTypes | null => {
  if (override === "on") {
    // A per-game "on" override works even before global settings exist.
    return { types: ALL_TYPES, enabledTypes: new Set(ALL_TYPES) };
  }

  if (!settings?.enabled) return null;

  const matrix = getMatrix(settings, shop);
  if (!matrix?.enabled) return null;

  const enabledTypes = new Set(enabledTypesFor(matrix));
  // Always resolve hero/grid so the "no native asset" fallback can use them,
  // even when the user has that specific asset type toggled off.
  const types = Array.from(new Set([...enabledTypes, ...FALLBACK_TYPES]));
  return { types, enabledTypes };
};

const materializeAutoAsset = async (
  best: SgdbAsset,
  type: SgdbAssetType,
  enabledTypes: Set<SgdbAssetType>,
  cacheImages: boolean
): Promise<SgdbSelectedAsset> => {
  // Only download to disk for enabled types. Fallback-only types (toggle off,
  // kept solely for the "no native asset" case) stay hotlinked to avoid caching
  // images that will almost never be displayed.
  if (cacheImages && enabledTypes.has(type)) {
    const cached = await downloadImageToCache(best.url);
    if (cached) {
      return {
        url: cached,
        remoteUrl: best.url,
        source: "auto",
        assetId: best.id,
      };
    }
  }

  return { url: best.url, source: "auto", assetId: best.id };
};

const buildAutoSelection = async (
  existing: SgdbSelectionRecord | undefined,
  cache: SgdbVariantsCache,
  types: SgdbAssetType[],
  enabledTypes: Set<SgdbAssetType>,
  cacheImages: boolean,
  forceFresh: boolean
): Promise<{ selected: SgdbSelectionRecord["selected"]; changed: boolean }> => {
  const selected: SgdbSelectionRecord["selected"] = { ...existing?.selected };
  let changed = false;

  for (const type of types) {
    const current = selected[type];
    if (current?.source === "user") continue;

    const best = bestOf(cache, type);
    if (!best) continue;

    // Unchanged auto pick: skip re-download and re-write to avoid leveldb churn
    // on every library sync. forceFresh bypasses so re-caching can happen.
    const unchanged =
      !forceFresh && current?.source === "auto" && current.assetId === best.id;
    if (unchanged) continue;

    selected[type] = await materializeAutoAsset(
      best,
      type,
      enabledTypes,
      cacheImages
    );
    changed = true;
  }

  return { selected, changed };
};

export const matchGame = async (
  shop: GameShop,
  objectId: string,
  options: MatchGameOptions = {}
): Promise<boolean> => {
  const { forceFresh = false, silent = false } = options;

  if (shop === "custom") return false;
  if (!SteamGridDbClient.isAuthorized()) return false;

  const preferences = await getUserPreferencesRecord();
  const settings = preferences?.steamGridDb;
  const cacheImages = settings?.cacheImages ?? false;

  const gameKey = levelKeys.game(shop, objectId);
  const existing = await getSelection(gameKey);
  const override = existing?.override ?? "inherit";

  if (override === "off") return false;

  const resolved = resolveMatchTypes(override, settings, shop);
  if (!resolved?.types.length) return false;
  const { types, enabledTypes } = resolved;

  const game = await getGame(gameKey);
  if (!game || game.isDeleted) return false;

  const cache = await ensureVariants(
    gameKey,
    shop,
    objectId,
    game.title,
    types,
    forceFresh
  );
  if (!cache?.sgdbGameId) return false;

  const { selected, changed } = await buildAutoSelection(
    existing,
    cache,
    types,
    enabledTypes,
    cacheImages,
    forceFresh
  );

  const sgdbGameIdChanged = existing?.sgdbGameId !== cache.sgdbGameId;

  if (!changed && !sgdbGameIdChanged && existing) {
    return false;
  }

  const record: SgdbSelectionRecord = {
    objectId,
    shop,
    sgdbGameId: cache.sgdbGameId,
    override: existing?.override ?? "inherit",
    selected,
    updatedAt: Date.now(),
  };

  await gamesSgdbSelectionSublevel.put(gameKey, record);

  if (!silent && changed) {
    WindowManager.sendToAppWindows("on-library-batch-complete");
  }

  return changed;
};

const runPool = async <T>(
  items: T[],
  size: number,
  worker: (item: T) => Promise<void>
) => {
  let index = 0;

  const run = async () => {
    while (index < items.length) {
      const current = items[index];
      index += 1;
      await worker(current);
    }
  };

  await Promise.all(
    Array.from({ length: Math.min(size, items.length) }, () => run())
  );
};

let isRunning = false;

interface RunAutoMatchOptions {
  forceFresh?: boolean;
}

export const runAutoMatch = async (options: RunAutoMatchOptions = {}) => {
  const { forceFresh = false } = options;

  if (isRunning) return;
  if (!SteamGridDbClient.isAuthorized()) return;

  const preferences = await getUserPreferencesRecord();
  const settings = preferences?.steamGridDb;
  if (!settings?.enabled) return;

  isRunning = true;

  try {
    const [entries, selectionEntries] = await Promise.all([
      gamesSublevel.iterator().all(),
      gamesSgdbSelectionSublevel.iterator().all(),
    ]);
    const overrideByKey = new Map(
      selectionEntries.map(([key, record]) => [key, record.override])
    );
    const targets = entries
      .map(([, game]) => game)
      .filter((game) => !game.isDeleted && game.shop !== "custom")
      .filter((game) => {
        const key = levelKeys.game(game.shop, game.objectId);
        // Include games force-enabled per-game even if their shop is globally off.
        if (overrideByKey.get(key) === "on") return true;
        const matrix = getMatrix(settings, game.shop);
        return matrix?.enabled === true;
      });

    let processed = 0;

    await runPool(targets, POOL_SIZE, async (game) => {
      try {
        await matchGame(game.shop, game.objectId, { forceFresh, silent: true });
      } catch (error) {
        logger.warn("SteamGridDB auto-match failed", {
          objectId: game.objectId,
          error,
        });
      }

      await sleep(THROTTLE_MS);
      processed += 1;

      if (processed % 20 === 0) {
        WindowManager.sendToAppWindows("on-library-batch-complete");
      }
    });

    WindowManager.sendToAppWindows("on-library-batch-complete");
  } finally {
    isRunning = false;
  }
};

interface GetVariantsOptions {
  types?: SgdbAssetType[];
  forceFresh?: boolean;
  term?: string;
}

export const getVariants = async (
  shop: GameShop,
  objectId: string,
  options: GetVariantsOptions = {}
): Promise<SgdbVariantsCache | null> => {
  const { types = ALL_TYPES, forceFresh = false, term } = options;

  if (shop === "custom") return null;
  if (!SteamGridDbClient.isAuthorized()) return null;

  const gameKey = levelKeys.game(shop, objectId);
  const game = await getGame(gameKey);
  if (!game) return null;

  if (term != null) {
    const sgdbGameId = await SteamGridDbClient.searchGameId(
      normalizeTitle(term)
    );
    const base = emptyCache(sgdbGameId);

    if (sgdbGameId != null) {
      for (const type of types) {
        base[PLURAL[type]] = await SteamGridDbClient.getAssets(
          type,
          sgdbGameId
        );
        base.fetched.push(type);
        await sleep(THROTTLE_MS);
      }
    }

    await gamesSgdbVariantsCacheSublevel.put(gameKey, base);
    return base;
  }

  return ensureVariants(gameKey, shop, objectId, game.title, types, forceFresh);
};
