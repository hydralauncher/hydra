import { useState } from "react";
import type { PlayLaterEntry, PlayLaterViewMode } from "@types";

interface PlayLaterCardProps {
  entry: PlayLaterEntry;
  viewMode: PlayLaterViewMode;
  onClick: () => void;
}

/** A portrait cover in the compact and grid views, a hero banner in the large one. */
export function PlayLaterCard({
  entry,
  viewMode,
  onClick,
}: Readonly<PlayLaterCardProps>) {
  const [hasImageError, setHasImageError] = useState(false);
  const isLarge = viewMode === "large";

  const imageUrl = isLarge
    ? (entry.libraryHeroImageUrl ?? entry.libraryImageUrl)
    : (entry.coverImageUrl ?? entry.libraryImageUrl);

  const showImage = imageUrl && !hasImageError;

  return (
    <button
      type="button"
      className={`play-later-card play-later-card--${viewMode}`}
      onClick={onClick}
      title={entry.title}
    >
      {showImage ? (
        <img
          src={imageUrl}
          alt={entry.title}
          className="play-later-card__image"
          loading="lazy"
          onError={() => setHasImageError(true)}
        />
      ) : (
        <span className="play-later-card__placeholder">{entry.title}</span>
      )}

      {isLarge && showImage && (
        <span className="play-later-card__overlay">
          {entry.logoImageUrl ? (
            <img
              src={entry.logoImageUrl}
              alt=""
              className="play-later-card__logo"
            />
          ) : (
            <span className="play-later-card__title">{entry.title}</span>
          )}
        </span>
      )}
    </button>
  );
}
