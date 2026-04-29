import type { LibraryGame } from "@types";

export interface GameCoverImageSource {
  coverImageUrl?: string | null;
  libraryImageUrl?: string | null;
  iconUrl?: string | null;
}

export function resolveImageSource(
  imageUrl: string | null | undefined
): string {
  if (!imageUrl) return "";

  const trimmedImageUrl = imageUrl.trim();
  if (!trimmedImageUrl) return "";

  if (
    trimmedImageUrl.startsWith("http://") ||
    trimmedImageUrl.startsWith("https://") ||
    trimmedImageUrl.startsWith("data:") ||
    trimmedImageUrl.startsWith("blob:")
  ) {
    return trimmedImageUrl;
  }

  if (trimmedImageUrl.startsWith("local:")) {
    const normalizedLocalPath = trimmedImageUrl
      .slice("local:".length)
      .replaceAll("\\", "/");

    return `local:${normalizedLocalPath}`;
  }

  const normalizedPath = trimmedImageUrl.replaceAll("\\", "/");

  if (/^[A-Za-z]:\//.test(normalizedPath) || normalizedPath.startsWith("/")) {
    return `local:${normalizedPath}`;
  }

  return normalizedPath;
}

export function getGameImageSources(game: LibraryGame) {
  return [
    game.customIconUrl,
    game.coverImageUrl,
    game.libraryImageUrl,
    game.iconUrl,
  ]
    .map((source) => resolveImageSource(source))
    .filter((source, index, array) => {
      return source !== "" && array.indexOf(source) === index;
    });
}

export function getGameLandscapeImageSources(game: LibraryGame) {
  return [
    game.libraryImageUrl,
    game.coverImageUrl,
    game.customIconUrl,
    game.iconUrl,
  ]
    .map((source) => resolveImageSource(source))
    .filter((source, index, array) => {
      return source !== "" && array.indexOf(source) === index;
    });
}

export function getGameCoverImageSource(game: GameCoverImageSource) {
  return game.coverImageUrl ?? game.libraryImageUrl ?? game.iconUrl;
}

export function getGameLandscapeImageSource(game: GameCoverImageSource) {
  return game.libraryImageUrl ?? game.coverImageUrl ?? game.iconUrl;
}
