import "./styles.scss";

import cn from "classnames";
import type { MouseEventHandler } from "react";

export interface HorizontalStoreGameCardProps {
  coverImageUrl?: string | null;
  gameTitle: string;
  downloadSourceCount: number;
  forceHovered?: boolean;
  className?: string;
  onClick?: () => void;
  onContextMenu?: MouseEventHandler<HTMLElement>;
  onCoverImageError?: () => void;
}

function getDownloadSourcesLabel(downloadSourceCount: number) {
  const normalizedCount = Math.max(0, downloadSourceCount);
  const suffix = normalizedCount === 1 ? "source" : "sources";

  return `${normalizedCount} download ${suffix}`;
}

export function HorizontalStoreGameCard({
  coverImageUrl,
  gameTitle,
  downloadSourceCount,
  forceHovered = false,
  className,
  onClick,
  onContextMenu,
  onCoverImageError,
}: Readonly<HorizontalStoreGameCardProps>) {
  const rootClassName = cn("horizontal-store-game-card", className, {
    "horizontal-store-game-card--force-hovered": forceHovered,
  });
  const TitleTag = onClick == null ? "h3" : "span";

  const inner = (
    <>
      <div className="horizontal-store-game-card__cover">
        {coverImageUrl ? (
          <img
            src={coverImageUrl}
            alt={gameTitle}
            draggable={false}
            onError={onCoverImageError}
          />
        ) : (
          <div
            className="horizontal-store-game-card__cover-placeholder"
            aria-hidden="true"
          />
        )}
      </div>

      <div className="horizontal-store-game-card__body">
        <TitleTag className="horizontal-store-game-card__title">
          {gameTitle}
        </TitleTag>
        <p className="horizontal-store-game-card__subtitle">
          {getDownloadSourcesLabel(downloadSourceCount)}
        </p>
      </div>
    </>
  );

  if (onClick == null) {
    return (
      <div className={rootClassName} onContextMenu={onContextMenu}>
        {inner}
      </div>
    );
  }

  return (
    <button
      type="button"
      className={rootClassName}
      onClick={onClick}
      onContextMenu={onContextMenu}
    >
      {inner}
    </button>
  );
}
