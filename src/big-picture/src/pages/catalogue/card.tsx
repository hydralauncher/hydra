import type { CatalogueSearchResult } from "@types";
import { QuestionIcon } from "@phosphor-icons/react";
import { useMemo } from "react";
import { useNavigate } from "react-router-dom";
import { FocusItem, SourceAnchor, Typography } from "../../components";
import { getBigPictureGameDetailsPath } from "../../helpers";
import type { FocusOverrides } from "../../services";
import { getCatalogueCardFocusId } from "./navigation";

interface CardProps {
  game: CatalogueSearchResult;
  navigationOverrides?: FocusOverrides;
}

export function CatalogueCard({
  game,
  navigationOverrides,
}: Readonly<CardProps>) {
  const navigate = useNavigate();

  const uniqueDownloadSources = useMemo(() => {
    return Array.from(new Set(game.downloadSources));
  }, [game.downloadSources]);

  const gamePath = getBigPictureGameDetailsPath({
    shop: game.shop,
    objectId: game.objectId,
    title: game.title,
  });

  return (
    <FocusItem
      id={getCatalogueCardFocusId(game.id)}
      actions={{
        primary: () => navigate(gamePath),
      }}
      navigationOverrides={navigationOverrides}
      asChild
    >
      <div className="catalogue-card">
        <button
          type="button"
          className="catalogue-card__image"
          onClick={() => navigate(gamePath)}
        >
          {game.libraryImageUrl ? (
            <img src={game.libraryImageUrl} alt={game.title} loading="lazy" />
          ) : (
            <div className="catalogue-card__image-placeholder">
              <QuestionIcon size={28} />
            </div>
          )}
        </button>

        <div className="catalogue-card__body">
          <div className="catalogue-card__content">
            <div className="catalogue-card__content__title">
              <Typography
                variant="label"
                className="catalogue-card__content__title-text"
              >
                {game.title}
              </Typography>
            </div>

            <div className="catalogue-card__content__genres">
              <Typography
                variant="body"
                className="catalogue-card__content__genres-text"
              >
                {game.genres.slice(0, 3).join(", ")}
              </Typography>
            </div>
          </div>

          <div className="catalogue-card__download-sources">
            {uniqueDownloadSources.slice(0, 3).map((source) => (
              <SourceAnchor key={source} title={source} />
            ))}

            {uniqueDownloadSources.length > 3 ? (
              <SourceAnchor title={`+${uniqueDownloadSources.length - 3}`} />
            ) : null}
          </div>
        </div>
      </div>
    </FocusItem>
  );
}
