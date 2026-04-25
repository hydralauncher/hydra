import "./styles.scss";

import cn from "classnames";
import type { KeyboardEvent } from "react";

export interface VerticalStoreGameCardProps {
  coverImageUrl?: string | null;
  gameTitle: string;
  downloadSourceCount: number;
  forceHovered?: boolean;
  className?: string;
  onClick?: () => void;
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
  onClick,
  onCoverImageError,
}: Readonly<VerticalStoreGameCardProps>) {
  const handleCardKeyDown = (event: KeyboardEvent<HTMLElement>) => {
    if (onClick == null) return;
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      onClick();
    }
  };

  return (
    <div
      className={cn("vertical-store-game-card", className, {
        "vertical-store-game-card--force-hovered": forceHovered,
      })}
      onClick={onClick}
      onKeyDown={onClick != null ? handleCardKeyDown : undefined}
      role={onClick != null ? "button" : undefined}
      tabIndex={onClick != null ? 0 : undefined}
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
    </div>
  );
}
