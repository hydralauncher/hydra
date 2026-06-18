import type { LibraryGame, ShopAssets } from "@types";
import { resolveImageSource } from "./image";

type PreferredGameSource = Partial<
  Pick<
    LibraryGame,
    | "title"
    | "objectId"
    | "shop"
    | "customIconUrl"
    | "customLogoImageUrl"
    | "customHeroImageUrl"
    | "iconUrl"
    | "logoImageUrl"
    | "libraryHeroImageUrl"
    | "libraryImageUrl"
    | "coverImageUrl"
    | "logoPosition"
    | "downloadSources"
  >
>;

export interface PreferredGameAssets {
  objectId: string;
  shop: ShopAssets["shop"];
  title: string;
  iconUrl: string | null;
  logoImageUrl: string | null;
  libraryHeroImageUrl: string | null;
  libraryImageUrl: string | null;
  coverImageUrl: string | null;
  logoPosition: string | null;
  downloadSources?: string[];
}

export interface ResolvedPreferredGameAssets extends PreferredGameAssets {
  iconSrc: string;
  logoSrc: string;
  heroSrc: string;
  coverSrc: string;
  landscapeSrc: string;
}

function getFirstResolvedSource(
  ...sources: Array<string | null | undefined>
): string {
  for (const source of sources) {
    const resolvedSource = resolveImageSource(source);

    if (resolvedSource) {
      return resolvedSource;
    }
  }

  return "";
}

function getPreferredDownloadSources(
  game: PreferredGameSource | null | undefined,
  assets: ShopAssets | null | undefined
) {
  if (assets && "downloadSources" in assets) {
    return assets.downloadSources;
  }

  if (game && "downloadSources" in game) {
    return game.downloadSources;
  }

  return undefined;
}

export function getPreferredGameAssets(
  game: PreferredGameSource | null | undefined,
  assets: ShopAssets | null | undefined
): PreferredGameAssets {
  return {
    objectId: assets?.objectId ?? game?.objectId ?? "",
    shop: assets?.shop ?? game?.shop ?? "steam",
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
    downloadSources: getPreferredDownloadSources(game, assets),
  };
}

export function resolvePreferredGameAssets(
  game: PreferredGameSource | null | undefined,
  assets: ShopAssets | null | undefined
): ResolvedPreferredGameAssets {
  const preferredAssets = getPreferredGameAssets(game, assets);
  const iconSrc = resolveImageSource(preferredAssets.iconUrl);
  const logoSrc = resolveImageSource(preferredAssets.logoImageUrl);
  const heroSrc = getFirstResolvedSource(
    game?.customHeroImageUrl,
    game?.customIconUrl,
    assets?.libraryHeroImageUrl,
    game?.libraryHeroImageUrl,
    assets?.libraryImageUrl,
    game?.libraryImageUrl,
    assets?.iconUrl,
    game?.iconUrl
  );
  const coverSrc = getFirstResolvedSource(
    game?.customHeroImageUrl,
    game?.customIconUrl,
    assets?.coverImageUrl,
    game?.coverImageUrl,
    assets?.libraryImageUrl,
    game?.libraryImageUrl,
    assets?.iconUrl,
    game?.iconUrl
  );
  const landscapeSrc = getFirstResolvedSource(
    game?.customHeroImageUrl,
    game?.customIconUrl,
    assets?.libraryImageUrl,
    game?.libraryImageUrl,
    assets?.coverImageUrl,
    game?.coverImageUrl,
    assets?.iconUrl,
    game?.iconUrl
  );

  return {
    ...preferredAssets,
    iconSrc,
    logoSrc,
    heroSrc,
    coverSrc,
    landscapeSrc,
  };
}
