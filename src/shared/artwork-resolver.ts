import type { GameArtworkSelection, ShopAssets } from "@types";

type ComposableAssets = (ShopAssets & { updatedAt?: number }) | null;

export const composeAssetsWithArtwork = <T extends ComposableAssets>(
  assets: T,
  selection: GameArtworkSelection | null | undefined
): T => {
  if (!assets || !selection) return assets;

  const selected = selection.selected;

  return {
    ...assets,
    iconUrl: selected.icon?.url ?? assets.iconUrl,
    logoImageUrl: selected.logo?.url ?? assets.logoImageUrl,
    libraryHeroImageUrl: selected.hero?.url ?? assets.libraryHeroImageUrl,
    coverImageUrl: selected.grid?.url ?? assets.coverImageUrl,
  };
};
