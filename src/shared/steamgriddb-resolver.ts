import type {
  GameShop,
  SgdbAssetType,
  SgdbSelectionRecord,
  SgdbSettings,
  SgdbShopAssetMatrix,
  ShopAssets,
} from "@types";

type ComposableAssets = (ShopAssets & { updatedAt?: number }) | null;

const FALLBACK_TYPES = new Set<SgdbAssetType>(["hero", "grid"]);

const getShopMatrix = (
  shop: GameShop,
  settings: SgdbSettings
): SgdbShopAssetMatrix | null => {
  if (shop === "steam") return settings.matrix.steam;
  if (shop === "launchbox") return settings.matrix.launchbox;
  return null;
};

export const composeAssetsWithSgdb = (
  assets: ComposableAssets,
  shop: GameShop,
  sgdb: SgdbSelectionRecord | null | undefined,
  settings: SgdbSettings | null | undefined
): ComposableAssets => {
  if (!assets) return assets;
  if (shop === "custom") return assets;
  if (!sgdb) return assets;
  if (sgdb.override === "off") return assets;

  // A per-game "on" override must work even before global settings exist.
  if (!settings && sgdb.override !== "on") return assets;

  const shopMatrix = settings ? getShopMatrix(shop, settings) : null;

  const gameActive =
    sgdb.override === "on"
      ? true
      : !!settings?.enabled && !!shopMatrix?.enabled;

  const isTypeActive = (type: SgdbAssetType) => {
    if (sgdb.override === "on") return true;
    return gameActive && !!shopMatrix?.[type];
  };

  const resolveField = (
    type: SgdbAssetType,
    nativeValue: string | null
  ): string | null => {
    const selected = sgdb.selected[type];
    if (!selected) return nativeValue;

    if (selected.source === "user" || isTypeActive(type)) {
      return selected.url;
    }

    if (gameActive && FALLBACK_TYPES.has(type) && nativeValue == null) {
      return selected.url;
    }

    return nativeValue;
  };

  const iconUrl = resolveField("icon", assets.iconUrl);
  const logoImageUrl = resolveField("logo", assets.logoImageUrl);
  const libraryHeroImageUrl = resolveField("hero", assets.libraryHeroImageUrl);
  const coverImageUrl = resolveField("grid", assets.coverImageUrl);

  return {
    ...assets,
    iconUrl,
    logoImageUrl,
    libraryHeroImageUrl,
    coverImageUrl,
  };
};
