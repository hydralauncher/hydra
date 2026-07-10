import type { GameShop } from "./game.types";

export type SgdbAssetType = "grid" | "hero" | "logo" | "icon";

export type SgdbOverride = "inherit" | "on" | "off";

export interface SgdbSelectedAsset {
  url: string;
  remoteUrl?: string;
  source: "user" | "auto";
  assetId?: number;
}

export interface SgdbSelectionRecord {
  objectId: string;
  shop: GameShop;
  sgdbGameId: number | null;
  override: SgdbOverride;
  selected: Partial<Record<SgdbAssetType, SgdbSelectedAsset | null>>;
  updatedAt: number;
}

export interface SgdbAsset {
  id: number;
  score: number;
  url: string;
  thumb: string;
  width: number;
  height: number;
  style?: string;
}

export interface SgdbVariantsCache {
  sgdbGameId: number | null;
  grids: SgdbAsset[];
  heroes: SgdbAsset[];
  logos: SgdbAsset[];
  icons: SgdbAsset[];
  fetched: SgdbAssetType[];
  updatedAt: number;
}

export interface SgdbShopAssetMatrix {
  enabled: boolean;
  grid: boolean;
  hero: boolean;
  logo: boolean;
  icon: boolean;
}

export interface SgdbSettings {
  enabled: boolean;
  cacheImages: boolean;
  matrix: {
    steam: SgdbShopAssetMatrix;
    launchbox: SgdbShopAssetMatrix;
  };
}
