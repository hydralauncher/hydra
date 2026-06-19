import type { BigPictureToastOptions } from "../stores";
import { getDominantColorFromImage } from "./color";
import { resolvePreferredGameAssets } from "./preferred-assets";

type LibraryToastMutation = "added" | "removed";
type FavoriteToastMutation = "added" | "removed";

export interface LibraryToastSource {
  title: string;
  iconUrl?: string | null;
  customIconUrl?: string | null;
  coverImageUrl?: string | null;
  libraryImageUrl?: string | null;
  libraryHeroImageUrl?: string | null;
  customHeroImageUrl?: string | null;
  logoImageUrl?: string | null;
  customLogoImageUrl?: string | null;
  logoPosition?: string | null;
}

const dominantColorCache = new Map<string, string | null>();

async function getCachedDominantColor(
  imageUrl: string | undefined
): Promise<string | undefined> {
  if (!imageUrl) return undefined;

  if (dominantColorCache.has(imageUrl)) {
    return dominantColorCache.get(imageUrl) ?? undefined;
  }

  const color = await getDominantColorFromImage(imageUrl);
  dominantColorCache.set(imageUrl, color);

  return color ?? undefined;
}

function getToastTitle(title: string, mutation: LibraryToastMutation) {
  if (mutation === "added") {
    return `${title} was added to your library`;
  }

  return `${title} was removed from your library`;
}

function getToastMessage(mutation: LibraryToastMutation) {
  if (mutation === "added") {
    return "Ready to launch from your collection whenever you want.";
  }

  return "You can add it back anytime from the catalogue.";
}

function getFavoriteToastTitle(
  title: string,
  _mutation: FavoriteToastMutation
) {
  return title;
}

function getFavoriteToastMessage(mutation: FavoriteToastMutation) {
  if (mutation === "added") {
    return "Was added to your favorites for quicker access.";
  }

  return "Was removed from your favorites.";
}

export async function buildGameToastVisualOptions(
  game: LibraryToastSource,
  options: { color?: string | null } = {}
): Promise<Pick<BigPictureToastOptions, "imageUrl" | "color">> {
  const preferredAssets = resolvePreferredGameAssets(game, null);
  const imageUrl =
    preferredAssets.coverSrc || preferredAssets.iconSrc || undefined;
  const colorSource =
    preferredAssets.heroSrc ||
    preferredAssets.landscapeSrc ||
    preferredAssets.coverSrc ||
    preferredAssets.iconSrc ||
    undefined;
  const color = options.color ?? (await getCachedDominantColor(colorSource));

  return {
    imageUrl,
    color: color ?? undefined,
  };
}

export async function buildLibraryToastOptions(
  game: LibraryToastSource,
  mutation: LibraryToastMutation,
  options: { color?: string | null } = {}
): Promise<{ title: string } & BigPictureToastOptions> {
  const { imageUrl, color } = await buildGameToastVisualOptions(game, options);

  return {
    title: getToastTitle(game.title, mutation),
    message: getToastMessage(mutation),
    imageUrl,
    color: color ?? undefined,
  };
}

export async function buildFavoriteToastOptions(
  game: LibraryToastSource,
  mutation: FavoriteToastMutation,
  options: { color?: string | null } = {}
): Promise<{ title: string } & BigPictureToastOptions> {
  const { imageUrl, color } = await buildGameToastVisualOptions(game, options);

  return {
    title: getFavoriteToastTitle(game.title, mutation),
    message: getFavoriteToastMessage(mutation),
    imageUrl,
    color: color ?? undefined,
  };
}
