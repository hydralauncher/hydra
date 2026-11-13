import type { LibraryGame } from "@types";

export interface DownloadArtwork {
  url: string;
  isFitted: boolean;
  fallbackUrl?: string;
}

const getSteamHeaderUrl = (objectId: string) =>
  `https://shared.steamstatic.com/store_item_assets/steam/apps/${objectId}/header.jpg`;

export const getDownloadArtwork = (
  game: LibraryGame,
  variant: "hero" | "thumbnail"
): DownloadArtwork => {
  if (game.customHeroImageUrl) {
    return { url: game.customHeroImageUrl, isFitted: false };
  }

  if (variant === "hero") {
    return {
      url: game.libraryHeroImageUrl || game.libraryImageUrl || "",
      isFitted: false,
    };
  }

  if (game.shop === "launchbox") {
    const isHeroChosen = Boolean(
      game.libraryHeroImageUrl && game.selectedArtworkTypes?.includes("hero")
    );
    return {
      url:
        game.libraryHeroImageUrl || game.libraryImageUrl || game.iconUrl || "",
      isFitted: !isHeroChosen,
    };
  }

  const candidates = [
    game.libraryImageUrl,
    game.libraryHeroImageUrl,
    game.customCoverImageUrl,
    game.coverImageUrl,
  ];
  const fittedUrl = candidates.find(Boolean) ?? "";

  if (game.shop === "steam") {
    return {
      url: getSteamHeaderUrl(game.objectId),
      fallbackUrl: fittedUrl,
      isFitted: false,
    };
  }

  return { url: fittedUrl, isFitted: false };
};

interface DownloadArtworkImageProps {
  artwork: DownloadArtwork;
  alt: string;
  showForeground?: boolean;
}

export function DownloadArtworkImage({
  artwork,
  alt,
  showForeground = true,
}: Readonly<DownloadArtworkImageProps>) {
  if (!artwork.isFitted) {
    const { fallbackUrl } = artwork;
    return (
      <img
        src={artwork.url}
        alt={alt}
        onError={(event) => {
          if (fallbackUrl && event.currentTarget.src !== fallbackUrl) {
            event.currentTarget.src = fallbackUrl;
          }
        }}
      />
    );
  }

  return (
    <>
      <img
        src={artwork.url}
        alt=""
        aria-hidden="true"
        className="download-group__artwork-blur"
      />
      {showForeground && (
        <img
          src={artwork.url}
          alt={alt}
          className="download-group__artwork-fitted"
        />
      )}
    </>
  );
}
