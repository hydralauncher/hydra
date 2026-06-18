import type { LibraryGame, ShopAssets } from "@types";

type PreferredGameSource = Partial<
  Pick<
    LibraryGame,
    | "title"
    | "customIconUrl"
    | "customLogoImageUrl"
    | "customHeroImageUrl"
    | "iconUrl"
    | "logoImageUrl"
    | "libraryHeroImageUrl"
    | "libraryImageUrl"
    | "coverImageUrl"
    | "logoPosition"
  >
>;

export interface PreferredGameAssets {
  title: string;
  iconUrl: string | null;
  logoImageUrl: string | null;
  libraryHeroImageUrl: string | null;
  libraryImageUrl: string | null;
  coverImageUrl: string | null;
  logoPosition: string | null;
  downloadSources: string[];
}

export function getPreferredGameAssets(
  game: PreferredGameSource | null | undefined,
  assets: ShopAssets | null | undefined
): PreferredGameAssets {
  return {
    title: assets?.title ?? game?.title ?? "",
    iconUrl: game?.customIconUrl ?? assets?.iconUrl ?? game?.iconUrl ?? null,
    logoImageUrl:
      game?.customLogoImageUrl ??
      assets?.logoImageUrl ??
      game?.logoImageUrl ??
      null,
    libraryHeroImageUrl:
      game?.customHeroImageUrl ??
      assets?.libraryHeroImageUrl ??
      game?.libraryHeroImageUrl ??
      null,
    libraryImageUrl: assets?.libraryImageUrl ?? game?.libraryImageUrl ?? null,
    coverImageUrl: assets?.coverImageUrl ?? game?.coverImageUrl ?? null,
    logoPosition: assets?.logoPosition ?? game?.logoPosition ?? null,
    downloadSources: assets?.downloadSources ?? [],
  };
}
