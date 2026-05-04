import type { CatalogueSearchResult } from "@types";
import { useTranslation } from "react-i18next";
import { DownloadIcon } from "@primer/octicons-react";
import "./big-picture-catalogue-card.scss";

interface BigPictureCatalogueCardProps {
  game: CatalogueSearchResult;
  onClick: () => void;
  index?: number;
}

export function BigPictureCatalogueCard({
  game,
  onClick,
  index = 0,
}: BigPictureCatalogueCardProps) {
  const { t } = useTranslation("big_picture");

  const isAvailable = game.downloadSources.length > 0;
  const staggerDelay = Math.min(index * 30, 600);

  const cardClass = [
    "bp-catalogue-card",
    !isAvailable && "bp-catalogue-card--unavailable",
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <button
      type="button"
      className={cardClass}
      data-bp-focusable
      onClick={onClick}
      style={{ "--stagger-delay": `${staggerDelay}ms` } as React.CSSProperties}
    >
      <div className="bp-catalogue-card__image-wrapper">
        {game.libraryImageUrl ? (
          <img
            src={game.libraryImageUrl}
            alt={game.title}
            className="bp-catalogue-card__image"
            loading="lazy"
          />
        ) : (
          <div className="bp-catalogue-card__placeholder" />
        )}

        {!isAvailable && (
          <div className="bp-catalogue-card__badge bp-catalogue-card__badge--unavailable">
            <DownloadIcon size={16} />
            <span className="bp-catalogue-card__badge-slash" />
          </div>
        )}
      </div>

      <div className="bp-catalogue-card__info">
        <span className="bp-catalogue-card__title">{game.title}</span>
        {game.genres.length > 0 && (
          <span className="bp-catalogue-card__genres">
            {game.genres.slice(0, 2).join(" · ")}
          </span>
        )}
        <span
          className={`bp-catalogue-card__status ${
            isAvailable
              ? "bp-catalogue-card__status--available"
              : "bp-catalogue-card__status--unavailable"
          }`}
        >
          {isAvailable ? t("available") : t("unavailable")}
        </span>
      </div>
    </button>
  );
}
