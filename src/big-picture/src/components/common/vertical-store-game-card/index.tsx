import "./styles.scss";

import cn from "classnames";

export interface VerticalStoreGameCardProps {
  coverImageUrl?: string | null;
  gameTitle: string;
  downloadSourceCount: number;
  forceHovered?: boolean;
  className?: string;
  onCoverImageError?: () => void;
}

function getDownloadSourcesLabel(downloadSourceCount: number) {
  const normalizedCount = Math.max(0, downloadSourceCount);
  const suffix = normalizedCount === 1 ? "source" : "sources";

  return `${normalizedCount} download ${suffix}`;
}

export function VerticalStoreGameCard({
  coverImageUrl,
  gameTitle,
  downloadSourceCount,
  forceHovered = false,
  className,
  onCoverImageError,
}: Readonly<VerticalStoreGameCardProps>) {
  return (
    <article
      className={cn("vertical-store-game-card", className, {
        "vertical-store-game-card--force-hovered": forceHovered,
      })}
    >
      <div className="vertical-store-game-card__cover">
        {coverImageUrl ? (
          <img
            src={coverImageUrl}
            alt={gameTitle}
            draggable={false}
            onError={onCoverImageError}
          />
        ) : (
          <div
            className="vertical-store-game-card__cover-placeholder"
            aria-hidden="true"
          />
        )}
      </div>

      <div className="vertical-store-game-card__body">
        <h3 className="vertical-store-game-card__title">{gameTitle}</h3>
        <p className="vertical-store-game-card__subtitle">
          {getDownloadSourcesLabel(downloadSourceCount)}
        </p>
      </div>
    </article>
  );
}
