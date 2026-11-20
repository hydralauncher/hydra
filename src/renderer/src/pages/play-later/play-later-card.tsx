import { useState } from "react";
import type { PlayLaterEntry, PlayLaterViewMode } from "@types";
import { VerticalCoverCard } from "@renderer/components";
import { getVerticalCoverCardImageSources } from "@renderer/components/vertical-cover-card/vertical-cover-card-image-sources";

interface PlayLaterCardProps {
  entry: PlayLaterEntry;
  viewMode: PlayLaterViewMode;
  onClick: () => void;
}

/** The shared cover card in the compact and grid views, a hero banner in the large one. */
export function PlayLaterCard({
  entry,
  viewMode,
  onClick,
}: Readonly<PlayLaterCardProps>) {
  if (viewMode !== "large") {
    return (
      <VerticalCoverCard
        gameTitle={entry.title}
        coverImageUrls={[
          entry.coverImageUrl,
          entry.libraryImageUrl,
          entry.iconUrl,
        ]}
        catalogueImages={entry.images}
        useClassicsLayout={entry.shop === "launchbox"}
        onClick={onClick}
      />
    );
  }

  const sources = getVerticalCoverCardImageSources([
    entry.libraryHeroImageUrl,
    entry.libraryImageUrl,
  ]);

  // The key starts over from the first image whenever the sources change.
  return (
    <PlayLaterBanner
      key={sources.join("\u0000")}
      entry={entry}
      sources={sources}
      onClick={onClick}
    />
  );
}

function PlayLaterBanner({
  entry,
  sources,
  onClick,
}: Readonly<{
  entry: PlayLaterEntry;
  sources: string[];
  onClick: () => void;
}>) {
  const [imageIndex, setImageIndex] = useState(0);
  const [hasLogoError, setHasLogoError] = useState(false);
  const imageUrl = sources[imageIndex];

  return (
    <button
      type="button"
      className="play-later-card"
      onClick={onClick}
      title={entry.title}
    >
      {imageUrl ? (
        <img
          src={imageUrl}
          alt={entry.title}
          className="play-later-card__image"
          loading="lazy"
          onError={() => setImageIndex((index) => index + 1)}
        />
      ) : (
        <span className="play-later-card__placeholder">{entry.title}</span>
      )}

      {imageUrl && (
        <span className="play-later-card__overlay">
          {entry.logoImageUrl && !hasLogoError ? (
            <img
              src={entry.logoImageUrl}
              alt=""
              className="play-later-card__logo"
              onError={() => setHasLogoError(true)}
            />
          ) : (
            <span className="play-later-card__title">{entry.title}</span>
          )}
        </span>
      )}
    </button>
  );
}
