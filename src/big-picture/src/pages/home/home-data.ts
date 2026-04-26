import type { GameShop, ShopAssets, TrendingGame } from "@types";

type UnknownRecord = Record<string, unknown>;

const isRecord = (value: unknown): value is UnknownRecord => {
  return typeof value === "object" && value !== null;
};

const isGameShop = (value: unknown): value is GameShop => {
  return value === "steam" || value === "custom";
};

const readString = (value: unknown): string | null => {
  return typeof value === "string" && value.length > 0 ? value : null;
};

const readNullableString = (value: unknown): string | null => {
  return typeof value === "string" ? value : null;
};

export function normalizeShopAssets(value: unknown): ShopAssets | null {
  if (!isRecord(value)) return null;

  const objectId = readString(value.objectId);
  const title = readString(value.title);
  const { shop } = value;

  if (!objectId || !title || !isGameShop(shop)) {
    return null;
  }

  return {
    objectId,
    shop,
    title,
    iconUrl: readNullableString(value.iconUrl),
    libraryHeroImageUrl: readNullableString(value.libraryHeroImageUrl),
    libraryImageUrl: readNullableString(value.libraryImageUrl),
    logoImageUrl: readNullableString(value.logoImageUrl),
    logoPosition: readNullableString(value.logoPosition),
    coverImageUrl: readNullableString(value.coverImageUrl),
    downloadSources: Array.isArray(value.downloadSources)
      ? value.downloadSources.filter(
          (source): source is string => typeof source === "string"
        )
      : [],
  };
}

export function normalizeShopAssetsList(value: unknown): ShopAssets[] {
  if (!Array.isArray(value)) return [];

  return value.flatMap((game) => {
    const normalizedGame = normalizeShopAssets(game);

    return normalizedGame ? [normalizedGame] : [];
  });
}

export function normalizeTrendingGame(value: unknown): TrendingGame | null {
  if (!isRecord(value)) return null;

  const assets = normalizeShopAssets(value);

  if (!assets) return null;

  return {
    ...assets,
    description: readNullableString(value.description),
    uri: readNullableString(value.uri) ?? "",
  };
}
