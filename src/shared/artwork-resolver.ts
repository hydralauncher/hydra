import type {
  ArtworkAssetType,
  GameArtworkSelection,
  ShopAssets,
  ArtworkItem,
} from "@types";

type ComposableAssets = (ShopAssets & { updatedAt?: number }) | null;
export const EPIC_DEFAULT_ICON_MAX_DIMENSION = 128;

/** Default Epic artwork never replaces an explicit user selection. */
export function composeEpicDefaultArtwork(
  assets: ShopAssets,
  icons: ArtworkItem[],
  grids: ArtworkItem[],
  landscapeGrids: ArtworkItem[] = []
): ShopAssets {
  if (assets.shop !== "epic") return assets;
  const safe = (item: ArtworkItem) =>
    item != null &&
    typeof item.url === "string" &&
    !item.nsfw &&
    !item.humor &&
    /^https:\/\//i.test(item.url);
  const icon = icons
    .flatMap((item) => {
      if (!safe(item)) return [];
      if (item.width !== 0 || item.height !== 0) return [item];
      // ICO assets have multiple sizes and SGDB reports 0x0. Its PNG preview
      // names the requested dimensions, so use that bounded preview instead.
      try {
        const thumbnail = new URL(item.thumb);
        const dimensions = /\/(\d+)x(\d+)\.png$/.exec(thumbnail.pathname);
        if (
          thumbnail.protocol !== "https:" ||
          !thumbnail.hostname.endsWith(".steamgriddb.com") ||
          !thumbnail.pathname.startsWith("/icon/") ||
          !dimensions
        )
          return [];
        return [
          {
            ...item,
            url: thumbnail.href,
            width: Number(dimensions[1]),
            height: Number(dimensions[2]),
          },
        ];
      } catch {
        return [];
      }
    })
    .filter(
      (item) =>
        safe(item) &&
        item.width > 0 &&
        item.height > 0 &&
        item.width <= EPIC_DEFAULT_ICON_MAX_DIMENSION &&
        item.height <= EPIC_DEFAULT_ICON_MAX_DIMENSION
    )
    .sort(
      (a, b) => b.score - a.score || a.width * a.height - b.width * b.height
    )[0];
  const selectGrid = (items: ArtworkItem[], portrait: boolean) =>
    items
      .filter(
        (item) =>
          safe(item) &&
          item.style === "no_logo" &&
          item.width > 0 &&
          item.height > 0 &&
          (portrait ? item.height > item.width : item.width > item.height)
      )
      .sort((a, b) => b.score - a.score)[0];
  const grid = selectGrid(grids, true);
  const landscape = selectGrid(landscapeGrids, false);
  return {
    ...assets,
    iconUrl: icon?.url ?? null,
    coverImageUrl: grid?.url ?? assets.coverImageUrl,
    libraryImageUrl: grid?.url ?? assets.libraryImageUrl,
    libraryHeroImageUrl: landscape?.url ?? assets.libraryHeroImageUrl,
  };
}

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
    selectedArtworkTypes: Object.keys(selected) as ArtworkAssetType[],
  };
};
