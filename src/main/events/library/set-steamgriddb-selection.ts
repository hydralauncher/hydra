import { registerEvent } from "../register-event";
import {
  gamesSgdbSelectionSublevel,
  gamesSgdbVariantsCacheSublevel,
  levelKeys,
} from "@main/level";
import {
  downloadImageToCache,
  getUserPreferencesRecord,
  WindowManager,
} from "@main/services";
import type {
  GameShop,
  SgdbAssetType,
  SgdbSelectedAsset,
  SgdbSelectionRecord,
  SgdbVariantsCache,
} from "@types";

interface SetSelectionParams {
  shop: GameShop;
  objectId: string;
  type: SgdbAssetType;
  url?: string;
  assetId?: number;
  clear?: boolean;
}

const PLURAL: Record<SgdbAssetType, "grids" | "heroes" | "logos" | "icons"> = {
  grid: "grids",
  hero: "heroes",
  logo: "logos",
  icon: "icons",
};

const materializeAsset = async (
  url: string,
  assetId: number | undefined,
  source: "user" | "auto"
): Promise<SgdbSelectedAsset> => {
  const preferences = await getUserPreferencesRecord();
  const cacheImages = preferences?.steamGridDb?.cacheImages ?? false;

  if (cacheImages) {
    const cached = await downloadImageToCache(url);
    if (cached) return { url: cached, remoteUrl: url, source, assetId };
  }

  return { url, source, assetId };
};

const pickAutoFromCache = (
  cache: SgdbVariantsCache | undefined,
  type: SgdbAssetType
) => cache?.[PLURAL[type]]?.[0] ?? null;

const setSteamGridDbSelection = async (
  _event: Electron.IpcMainInvokeEvent,
  params: SetSelectionParams
) => {
  const { shop, objectId, type, url, assetId, clear } = params;
  const gameKey = levelKeys.game(shop, objectId);

  const existing = await gamesSgdbSelectionSublevel.get(gameKey);
  const selected: SgdbSelectionRecord["selected"] = {
    ...(existing?.selected ?? {}),
  };

  if (clear || !url) {
    const cache = await gamesSgdbVariantsCacheSublevel.get(gameKey);
    const best = pickAutoFromCache(cache, type);

    if (best) {
      selected[type] = await materializeAsset(best.url, best.id, "auto");
    } else {
      delete selected[type];
    }
  } else {
    selected[type] = await materializeAsset(url, assetId, "user");
  }

  const record: SgdbSelectionRecord = {
    objectId,
    shop,
    sgdbGameId: existing?.sgdbGameId ?? null,
    override: existing?.override ?? "inherit",
    selected,
    updatedAt: Date.now(),
  };

  await gamesSgdbSelectionSublevel.put(gameKey, record);
  WindowManager.sendToAppWindows("on-library-batch-complete");

  return record;
};

registerEvent("setSteamGridDbSelection", setSteamGridDbSelection);
