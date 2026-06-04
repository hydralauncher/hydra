import "./styles.scss";

import cn from "classnames";
import type { MouseEventHandler } from "react";

export interface VerticalStoreGameCardProps {
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

export function VerticalStoreGameCard({
  coverImageUrl,
  gameTitle,
  downloadSourceCount,
  forceHovered = false,
  className,
  onClick,
  onContextMenu,
  onCoverImageError,
}: Readonly<VerticalStoreGameCardProps>) {
  const rootClassName = cn("vertical-store-game-card", className, {
    "vertical-store-game-card--force-hovered": forceHovered,
  });
  const TitleTag = onClick == null ? "h3" : "span";

  const inner = (
    <>
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
        <TitleTag className="vertical-store-game-card__title">
          {gameTitle}
        </TitleTag>
        <p className="vertical-store-game-card__subtitle">
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
